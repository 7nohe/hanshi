import * as path from 'node:path';
import * as vscode from 'vscode';
import { InlineCompletionService } from './ai/inline-completion';
import { DocumentSync } from './sync/document-sync';
import type {
  HostToWebviewMessage,
  RequestCompletionMessage,
  ResolveImageSrcRequestMessage,
  SaveImageRequestMessage,
  SelectionResponseMessage,
  WebviewToHostMessage,
} from './shared/protocol';

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

export class HanshiEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'hanshi.markdownEditor';
  private readonly relatedFilesCache = new Map<string, Array<{ path: string; excerpt: string }>>();

  private static activeWebview: vscode.Webview | undefined;
  private static activeDocument: vscode.TextDocument | undefined;
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

    const startPos = document.positionAt(offsets.start);
    const endPos = document.positionAt(offsets.end);

    return {
      text: response.selectedText,
      filePath: document.uri.fsPath,
      startLine: startPos.line + 1,
      startColumn: startPos.character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
    };
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
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

    const sync = new DocumentSync({
      document,
      postMessage: async (message) => {
        await webview.postMessage(message);
      },
      onWarning: (warning) => {
        void webview.postMessage({
          type: 'hostNotice',
          message: warning,
        } satisfies HostToWebviewMessage);
      },
      onError: (error) => {
        void vscode.window.showErrorMessage(error.message);
        void webview.postMessage({
          type: 'hostError',
          message: error.message,
        } satisfies HostToWebviewMessage);
      },
    });
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
      getEnabled: () => {
        return vscode.workspace.getConfiguration('hanshi', document.uri).get('aiCompletions.enabled', true);
      },
      languageModelAccessInformation: this.context.languageModelAccessInformation,
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      void sync.handleDocumentChange(event);
    });

    webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      try {
        switch (message.type) {
          case 'ready':
            await sync.bootstrap(webviewPanel.active);
            return;
          case 'edit':
            await sync.applyWebviewEdit(message);
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

    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        HanshiEditorProvider.activeWebview = webview;
        HanshiEditorProvider.activeDocument = document;
      }
      void webview.postMessage({
        type: 'setReadonly',
        editable: !webviewPanel.active ? false : !document.isClosed,
      } satisfies HostToWebviewMessage);
    });

    HanshiEditorProvider.activeWebview = webview;
    HanshiEditorProvider.activeDocument = document;

    webviewPanel.onDidDispose(() => {
      if (HanshiEditorProvider.activeWebview === webview) {
        HanshiEditorProvider.activeWebview = undefined;
        HanshiEditorProvider.activeDocument = undefined;
      }
      changeSubscription.dispose();
      completions.dispose();
      sync.dispose();
    });
  }

  private async handleSaveImage(
    document: vscode.TextDocument,
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
    document: vscode.TextDocument,
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
    document: vscode.TextDocument,
    name: string,
    dataUrl: string,
  ): Promise<{ alt: string; path: string }> {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/\r\n]+=*)$/);

    if (!match) {
      throw new Error('Image payload is not a valid image data URL.');
    }

    const [, mime, base64] = match;
    const bytes = Buffer.from(base64, 'base64');
    const rawExt = (mime.split('/')[1] ?? 'png').replace(/[^a-zA-Z0-9]/g, '');
    const extension = rawExt || 'png';
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
    document: vscode.TextDocument,
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

    const resolvedUri = webview.asWebviewUri(vscode.Uri.file(resolvedPath));

    return resolvedUri.toString();
  }

  private async enrichCompletionRequest(
    document: vscode.TextDocument,
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
    document: vscode.TextDocument,
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
    document: vscode.TextDocument,
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
