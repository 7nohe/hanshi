import * as path from 'node:path';
import * as vscode from 'vscode';
import { InlineCompletionService } from './ai/inline-completion';
import { safeNormalizeMarkdown } from './sync/markdown-normalizer';
import type {
  EditMessage,
  ExternalUpdateReason,
  HostToWebviewMessage,
  RequestCompletionMessage,
  ResolveImageSrcRequestMessage,
  SaveImageRequestMessage,
  SelectionResponseMessage,
  WebviewToHostMessage,
} from './shared/protocol';

interface TextBackedDocument {
  uri: vscode.Uri;
  getText(): string;
}

export interface SelectionRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SelectionResult extends SelectionRange {
  text: string;
  filePath: string;
}

class HanshiDocument implements vscode.CustomDocument, TextBackedDocument {
  private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidDispose = this.onDidDisposeEmitter.event;
  public readonly panels = new Set<vscode.WebviewPanel>();
  private editQueue: Promise<void> = Promise.resolve();

  public constructor(
    public readonly uri: vscode.Uri,
    private text: string,
    public version = 1,
  ) {}

  public getText(): string {
    return this.text;
  }

  public replaceText(next: string, version = this.version + 1): number {
    this.text = next;
    this.version = version;
    return this.version;
  }

  public async enqueueEdit<T>(task: () => Promise<T>): Promise<T> {
    const run = this.editQueue.then(task, task);
    this.editQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public dispose(): void {
    this.panels.clear();
    this.onDidDisposeEmitter.fire();
    this.onDidDisposeEmitter.dispose();
  }
}

export function formatSelectionRef(sel: SelectionResult): string {
  if (sel.startLine === sel.endLine) {
    return `${sel.filePath}:${sel.startLine}:${sel.startColumn}-${sel.endColumn}`;
  }
  return `${sel.filePath}:${sel.startLine}:${sel.startColumn}-${sel.endLine}:${sel.endColumn}`;
}

export async function copySelectionRefToClipboard(): Promise<void> {
  const sel = await HanshiEditorProvider.getSelection();

  if (!sel) {
    void vscode.window.showInformationMessage('No text selected in Hanshi editor.');
    return;
  }

  const ref = formatSelectionRef(sel);
  await vscode.env.clipboard.writeText(ref);
  void vscode.window.showInformationMessage(`Copied: ${ref}`);
}

export class HanshiEditorProvider implements vscode.CustomEditorProvider<HanshiDocument> {
  public static readonly viewType = 'hanshi.markdownEditor';
  private readonly relatedFilesCache = new Map<string, Array<{ path: string; excerpt: string }>>();
  private readonly onDidChangeCustomDocumentEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<HanshiDocument>>();
  public readonly onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;

  private static activeWebview: vscode.Webview | undefined;
  private static activeDocument: TextBackedDocument | undefined;
  private static selectionCallbacks = new Map<string, (response: SelectionResponseMessage) => void>();
  private static requestSequence = 0;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public static async getSelection(): Promise<SelectionResult | undefined> {
    if (!this.activeWebview || !this.activeDocument) {
      return undefined;
    }

    const requestId = `sel-${++this.requestSequence}`;
    const webview = this.activeWebview;
    const document = this.activeDocument;

    const response = await new Promise<SelectionResponseMessage | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.selectionCallbacks.delete(requestId);
        resolve(undefined);
      }, 3000);
      this.selectionCallbacks.set(requestId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      void webview.postMessage({ type: 'getSelection', requestId } satisfies HostToWebviewMessage);
    });

    if (!response || !response.selectedText) {
      return undefined;
    }

    const offsets = findSelectionOffsets(
      document.getText(),
      response.selectedText,
      response.contextBefore,
    );

    if (!offsets) {
      return undefined;
    }

    const textDocument = await vscode.workspace.openTextDocument(document.uri);
    const startPos = textDocument.positionAt(offsets.start);
    const endPos = textDocument.positionAt(offsets.end);

    return {
      text: response.selectedText,
      filePath: document.uri.fsPath,
      startLine: startPos.line + 1,
      startColumn: startPos.character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
    };
  }

  private getCompletionsEnabled(document: TextBackedDocument): boolean {
    return vscode.workspace.getConfiguration('hanshi', document.uri).get('aiCompletions.enabled', true);
  }

  public async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<HanshiDocument> {
    const sourceUri = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
    const text = await this.readDocumentContents(sourceUri);
    const document = new HanshiDocument(uri, text);

    document.onDidDispose(() => {
      if (HanshiEditorProvider.activeDocument === document) {
        HanshiEditorProvider.activeDocument = undefined;
      }
    });

    return document;
  }

  public async resolveCustomEditor(
    document: HanshiDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const { webview } = webviewPanel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
      ],
    };

    webview.html = this.getHtmlForWebview(webview);
    document.panels.add(webviewPanel);
    HanshiEditorProvider.activeWebview = webview;
    HanshiEditorProvider.activeDocument = document;

    const completions = new InlineCompletionService({
      postMessage: async (message) => {
        await webview.postMessage(message);
      },
      showNotice: (message) => {
        void webview.postMessage({
          type: 'hostNotice',
          message,
        } satisfies HostToWebviewMessage);
      },
      getEnabled: () => this.getCompletionsEnabled(document),
      languageModelAccessInformation: this.context.languageModelAccessInformation,
    });

    const configurationSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('hanshi.aiCompletions.enabled', document.uri)) {
        return;
      }

      void webview.postMessage({
        type: 'setCompletionsEnabled',
        enabled: this.getCompletionsEnabled(document),
      } satisfies HostToWebviewMessage);
    });

    const onDidReceiveMessage = webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      try {
        switch (message.type) {
          case 'ready':
            await webview.postMessage({
              type: 'init',
              markdown: document.getText(),
              version: document.version,
              editable: true,
              completionsEnabled: this.getCompletionsEnabled(document),
            } satisfies HostToWebviewMessage);
            return;
          case 'edit':
            await this.applyWebviewEdit(document, webviewPanel, message);
            return;
          case 'requestCompletion':
            await completions.handleRequest(await this.enrichCompletionRequest(document, message));
            return;
          case 'cancelCompletion':
            await completions.cancel(message.requestId, message.version);
            return;
          case 'saveImageRequest':
            await this.handleSaveImage(document, message, webview);
            return;
          case 'resolveImageSrcRequest':
            await this.handleResolveImageSrc(document, message, webview);
            return;
          case 'copySelectionContext':
            await copySelectionRefToClipboard();
            return;
          case 'requestHistory':
            await vscode.commands.executeCommand(message.direction === 'undo' ? 'undo' : 'redo');
            return;
          case 'selectionResponse': {
            const callback = HanshiEditorProvider.selectionCallbacks.get(message.requestId);
            if (callback) {
              HanshiEditorProvider.selectionCallbacks.delete(message.requestId);
              callback(message);
            }
            return;
          }
        }
      } catch (error) {
        const resolved = error instanceof Error ? error : new Error(String(error));
        void vscode.window.showErrorMessage(resolved.message);
        void webview.postMessage({
          type: 'hostError',
          message: resolved.message,
        } satisfies HostToWebviewMessage);
      }
    });

    const onDidChangeViewState = webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        HanshiEditorProvider.activeWebview = webview;
        HanshiEditorProvider.activeDocument = document;
      }
    });

    webviewPanel.onDidDispose(() => {
      document.panels.delete(webviewPanel);
      onDidReceiveMessage.dispose();
      onDidChangeViewState.dispose();
      configurationSubscription.dispose();
      completions.dispose();

      if (HanshiEditorProvider.activeWebview === webview) {
        HanshiEditorProvider.activeWebview = undefined;
        HanshiEditorProvider.activeDocument = undefined;
      }
    });
  }

  public async saveCustomDocument(
    document: HanshiDocument,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    await this.writeDocumentToUri(document, document.uri, cancellation);
  }

  public async saveCustomDocumentAs(
    document: HanshiDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    await this.writeDocumentToUri(document, destination, cancellation);
  }

  public async revertCustomDocument(
    document: HanshiDocument,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    throwIfCancelled(cancellation);
    const text = await this.readDocumentContents(document.uri);
    document.replaceText(text);
    await this.broadcastDocumentSnapshot(document, 'revert');
  }

  public async backupCustomDocument(
    document: HanshiDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    throwIfCancelled(cancellation);
    await vscode.workspace.fs.writeFile(
      context.destination,
      new TextEncoder().encode(document.getText()),
    );
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // Ignore cleanup errors for stale backups.
        }
      },
    };
  }

  private async applyWebviewEdit(
    document: HanshiDocument,
    sourcePanel: vscode.WebviewPanel,
    message: EditMessage,
  ): Promise<void> {
    await document.enqueueEdit(async () => {
      if (message.version < document.version) {
        await sourcePanel.webview.postMessage({
          type: 'externalUpdate',
          markdown: document.getText(),
          version: document.version,
          reason: 'stale',
        } satisfies HostToWebviewMessage);
        return;
      }

      const previous = document.getText();
      const next = message.markdown;

      if (previous === next) {
        return;
      }

      document.replaceText(next, message.version);
      await this.broadcastDocumentSnapshot(document, 'edit', sourcePanel);

      this.onDidChangeCustomDocumentEmitter.fire({
        document,
        label: 'Edit Markdown',
        undo: async () => {
          document.replaceText(previous);
          await this.broadcastDocumentSnapshot(document, 'undo');
        },
        redo: async () => {
          document.replaceText(next);
          await this.broadcastDocumentSnapshot(document, 'redo');
        },
      });
    });
  }

  private async broadcastDocumentSnapshot(
    document: HanshiDocument,
    reason: ExternalUpdateReason,
    exceptPanel?: vscode.WebviewPanel,
  ): Promise<void> {
    await Promise.allSettled(
      Array.from(document.panels).map(async (panel) => {
        if (panel === exceptPanel) {
          return;
        }
        await panel.webview.postMessage({
          type: 'externalUpdate',
          markdown: document.getText(),
          version: document.version,
          reason,
        } satisfies HostToWebviewMessage);
      }),
    );
  }

  private async writeDocumentToUri(
    document: HanshiDocument,
    target: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    throwIfCancelled(cancellation);
    const raw = document.getText();
    const normalized = safeNormalizeMarkdown(raw);

    if (normalized.warning) {
      await this.showNoticeToDocument(document, normalized.warning);
    }

    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(normalized.markdown));

    if (target.toString() === document.uri.toString() && normalized.markdown !== raw) {
      document.replaceText(normalized.markdown);
      await this.broadcastDocumentSnapshot(document, 'save-normalize');
    }
  }

  private async readDocumentContents(uri: vscode.Uri): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return '';
      }
      throw error;
    }
  }

  private async showNoticeToDocument(document: HanshiDocument, message: string): Promise<void> {
    await Promise.allSettled(
      Array.from(document.panels).map((panel) =>
        panel.webview.postMessage({
          type: 'hostNotice',
          message,
        } satisfies HostToWebviewMessage),
      ),
    );
  }


  private async handleSaveImage(
    document: TextBackedDocument,
    message: SaveImageRequestMessage,
    webview: vscode.Webview,
  ): Promise<void> {
    try {
      const { alt, path: relativePath } = await this.persistImage(document, message.name, message.dataUrl);
      await webview.postMessage({
        type: 'saveImageResult',
        requestId: message.requestId,
        alt,
        path: relativePath,
      } satisfies HostToWebviewMessage);
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(String(error));
      await webview.postMessage({
        type: 'saveImageResult',
        requestId: message.requestId,
        error: resolved.message,
      } satisfies HostToWebviewMessage);
    }
  }

  private async handleResolveImageSrc(
    document: TextBackedDocument,
    message: ResolveImageSrcRequestMessage,
    webview: vscode.Webview,
  ): Promise<void> {
    try {
      const resolvedSrc = this.resolveImageSrc(document, message.src, webview);
      await webview.postMessage({
        type: 'resolveImageSrcResult',
        requestId: message.requestId,
        resolvedSrc,
      } satisfies HostToWebviewMessage);
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(String(error));
      await webview.postMessage({
        type: 'resolveImageSrcResult',
        requestId: message.requestId,
        error: resolved.message,
      } satisfies HostToWebviewMessage);
    }
  }

  private async persistImage(
    document: TextBackedDocument,
    name: string,
    dataUrl: string,
  ): Promise<{ alt: string; path: string }> {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/\r\n]+=*)$/);

    if (!match) {
      throw new Error('Image payload is not a valid image data URL.');
    }

    const [, mime, base64] = match;
    const bytes = Buffer.from(base64, 'base64');
    const mimeSubtype = mime.split('/')[1] ?? 'png';
    const extension = mimeSubtypeToExtension(mimeSubtype);
    const parsed = path.parse(name);
    const safeBaseName = parsed.name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-');
    const documentDirectory = path.dirname(document.uri.fsPath);
    const assetDirectory = vscode.Uri.joinPath(vscode.Uri.file(documentDirectory), 'assets');
    await vscode.workspace.fs.createDirectory(assetDirectory);

    const suffix = Array.from({ length: 6 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const fileName = `${safeBaseName || 'image'}-${Date.now()}-${suffix}.${extension}`;
    const imageUri = vscode.Uri.joinPath(assetDirectory, fileName);
    await vscode.workspace.fs.writeFile(imageUri, bytes);

    const relativePath = path.relative(documentDirectory, imageUri.fsPath).split(path.sep).join('/');
    return {
      alt: parsed.name || 'image',
      path: relativePath,
    };
  }

  private resolveImageSrc(
    document: TextBackedDocument,
    src: string,
    webview: vscode.Webview,
  ): string {
    if (/^(?:[a-z]+:)?\/\//i.test(src) || /^(?:data|blob|vscode-webview):/i.test(src)) {
      return src;
    }

    if (path.isAbsolute(src)) {
      throw new Error('Absolute image paths are not allowed.');
    }

    const documentDirectory = path.dirname(document.uri.fsPath);
    const resolvedPath = path.resolve(documentDirectory, src);

    if (!resolvedPath.startsWith(documentDirectory + path.sep) && resolvedPath !== documentDirectory) {
      throw new Error('Image path escapes the document directory.');
    }

    return webview.asWebviewUri(vscode.Uri.file(resolvedPath)).toString();
  }

  private async enrichCompletionRequest(
    document: TextBackedDocument,
    message: RequestCompletionMessage,
  ): Promise<RequestCompletionMessage> {
    const relatedFiles = await this.collectRelatedMarkdownFiles(document, message.markdown);

    return {
      ...message,
      context: {
        ...message.context,
        relatedFiles,
      },
    };
  }

  private async collectRelatedMarkdownFiles(
    document: TextBackedDocument,
    markdown: string,
  ): Promise<Array<{ path: string; excerpt: string }>> {
    const linkedPaths = Array.from(extractMarkdownLinks(markdown)).slice(0, 4);
    const cacheKey = `${path.dirname(document.uri.fsPath)}::${linkedPaths.join('|')}`;
    const cached = this.relatedFilesCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const collected = new Map<string, { path: string; excerpt: string }>();
    const documentDir = path.dirname(document.uri.fsPath);

    const linkedResults = await Promise.all(
      linkedPaths.map((linkedPath) => {
        const resolved = vscode.Uri.file(path.resolve(documentDir, linkedPath));
        return this.readRelatedMarkdownFile(document, resolved);
      }),
    );

    for (const item of linkedResults) {
      if (item) {
        collected.set(item.path, item);
      }
    }

    if (collected.size < 3) {
      const folderPattern = new vscode.RelativePattern(documentDir, '*.md');
      const siblingFiles = await vscode.workspace.findFiles(folderPattern, '**/node_modules/**', 6);
      const siblingUris = siblingFiles.filter((s) => s.fsPath !== document.uri.fsPath).slice(0, 3 - collected.size);

      const siblingResults = await Promise.all(
        siblingUris.map((sibling) => this.readRelatedMarkdownFile(document, sibling)),
      );

      for (const item of siblingResults) {
        if (item) {
          collected.set(item.path, item);
        }
      }
    }

    const result = Array.from(collected.values()).slice(0, 3);
    this.relatedFilesCache.set(cacheKey, result);

    if (this.relatedFilesCache.size > 32) {
      const oldestKey = this.relatedFilesCache.keys().next().value;

      if (oldestKey) {
        this.relatedFilesCache.delete(oldestKey);
      }
    }

    return result;
  }

  private async readRelatedMarkdownFile(
    document: TextBackedDocument,
    uri: vscode.Uri,
  ): Promise<{ path: string; excerpt: string } | undefined> {
    if (path.extname(uri.fsPath).toLowerCase() !== '.md') {
      return undefined;
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes).trim();

      if (!text) {
        return undefined;
      }

      return {
        path: path.relative(path.dirname(document.uri.fsPath), uri.fsPath).split(path.sep).join('/'),
        excerpt: text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text,
      };
    } catch {
      return undefined;
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'index.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data: blob:; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Hanshi</title>
  </head>
  <body>
    <div id="app">
      <div id="workspace">
        <section id="frontmatter" data-visible="false" data-expanded="false" aria-label="Frontmatter summary">
          <div id="frontmatter-summary"></div>
          <button id="frontmatter-toggle" type="button">Show Raw</button>
          <pre id="frontmatter-raw"></pre>
        </section>
        <div id="editor"></div>
      </div>
      <div id="status" aria-live="polite"></div>
    </div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function createNonce(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

function stripMarkdownInline(line: string): string {
  return line
    .replace(/^[\s>]*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

export function findSelectionOffsets(
  sourceText: string,
  selectedPlainText: string,
  contextBefore: string,
): { start: number; end: number } | undefined {
  const matchIndex = sourceText.indexOf(selectedPlainText);

  if (matchIndex !== -1) {
    const secondMatch = sourceText.indexOf(selectedPlainText, matchIndex + 1);
    if (secondMatch === -1) {
      return { start: matchIndex, end: matchIndex + selectedPlainText.length };
    }

    const contextTail = contextBefore.split('\n').filter((l) => l.trim()).pop()?.trim() ?? '';
    if (contextTail) {
      let idx = matchIndex;
      while (idx !== -1) {
        const preceding = sourceText.slice(Math.max(0, idx - 500), idx);
        if (preceding.includes(contextTail)) {
          return { start: idx, end: idx + selectedPlainText.length };
        }
        idx = sourceText.indexOf(selectedPlainText, idx + 1);
      }
    }

    return { start: matchIndex, end: matchIndex + selectedPlainText.length };
  }

  const selectedLines = selectedPlainText
    .split('\n')
    .map((l) => stripMarkdownInline(l))
    .filter((l) => l && l !== '<br />' && l !== '<br/>');

  if (selectedLines.length === 0) {
    return undefined;
  }

  const sourceLines = sourceText.split('\n');
  const strippedSourceLines = sourceLines.map(stripMarkdownInline);
  const firstTarget = selectedLines[0];
  const lastTarget = selectedLines[selectedLines.length - 1];

  const contextLastLine = contextBefore
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? '';

  let searchFrom = 0;

  if (contextLastLine) {
    for (let i = 0; i < strippedSourceLines.length; i++) {
      if (strippedSourceLines[i].includes(contextLastLine)) {
        searchFrom = i + 1;
      }
    }
  }

  const findFirst = (from: number): number => {
    for (let i = from; i < strippedSourceLines.length; i++) {
      if (strippedSourceLines[i].includes(firstTarget)) {
        return i;
      }
    }
    return -1;
  };

  const primary = findFirst(searchFrom);
  const startLineIdx = primary !== -1 ? primary : findFirst(0);

  if (startLineIdx === -1) {
    return undefined;
  }

  let endLineIdx = startLineIdx;

  if (selectedLines.length > 1) {
    for (let i = startLineIdx; i < strippedSourceLines.length; i++) {
      if (strippedSourceLines[i].includes(lastTarget)) {
        endLineIdx = i;
        if (i > startLineIdx) {
          break;
        }
      }
    }
  }

  const startInSourceLine = sourceLines[startLineIdx].indexOf(firstTarget);
  const endInSourceLine = sourceLines[endLineIdx].indexOf(lastTarget);

  if (startInSourceLine === -1 || endInSourceLine === -1) {
    return undefined;
  }

  const lineStartOffset = (lineIdx: number): number => {
    let offset = 0;
    for (let i = 0; i < lineIdx; i++) {
      offset += sourceLines[i].length + 1;
    }
    return offset;
  };

  return {
    start: lineStartOffset(startLineIdx) + startInSourceLine,
    end: lineStartOffset(endLineIdx) + endInSourceLine + lastTarget.length,
  };
}

export function* extractMarkdownLinks(markdown: string): Generator<string> {
  const matches = markdown.matchAll(/\[[^\]]*]\(([^)\s#?]+\.md)\)/g);

  for (const match of matches) {
    const target = match[1]?.trim();

    if (target) {
      yield target;
    }
  }
}

const MIME_SUBTYPE_EXTENSIONS: Record<string, string> = {
  'svg+xml': 'svg',
  'jpeg': 'jpg',
  'tiff': 'tiff',
};

function mimeSubtypeToExtension(subtype: string): string {
  return MIME_SUBTYPE_EXTENSIONS[subtype] ?? (subtype.replace(/[^a-zA-Z0-9]/g, '') || 'png');
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
