import * as path from 'node:path';
import * as vscode from 'vscode';
import { InlineCompletionService } from './ai/inline-completion';
import { DocumentSync } from './sync/document-sync';
import type {
  HostToWebviewMessage,
  RequestCompletionMessage,
  ResolveImageSrcRequestMessage,
  SaveImageRequestMessage,
  WebviewToHostMessage,
} from './shared/protocol';

export class HanshiEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'hanshi.markdownEditor';
  private readonly relatedFilesCache = new Map<string, Array<{ path: string; excerpt: string }>>();

  public constructor(private readonly context: vscode.ExtensionContext) {}

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
      void webview.postMessage({
        type: 'setReadonly',
        editable: !webviewPanel.active ? false : !document.isClosed,
      } satisfies HostToWebviewMessage);
    });

    webviewPanel.onDidDispose(() => {
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
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);

    if (!match) {
      throw new Error('Image payload is not a valid data URL.');
    }

    const [, mime, base64] = match;
    const bytes = Buffer.from(base64, 'base64');
    const extension = mime.split('/')[1] ?? 'png';
    const parsed = path.parse(name);
    const safeBaseName = parsed.name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-');
    const documentDirectory = path.dirname(document.uri.fsPath);
    const assetDirectory = vscode.Uri.joinPath(vscode.Uri.file(documentDirectory), 'assets');
    await vscode.workspace.fs.createDirectory(assetDirectory);

    const fileName = `${safeBaseName || 'image'}-${Date.now()}.${extension}`;
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

    const resolvedPath = path.isAbsolute(src)
      ? src
      : path.resolve(path.dirname(document.uri.fsPath), src);
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

function* extractMarkdownLinks(markdown: string): Generator<string> {
  const matches = markdown.matchAll(/\[[^\]]*]\(([^)\s#?]+\.md)\)/g);

  for (const match of matches) {
    const target = match[1]?.trim();

    if (target) {
      yield target;
    }
  }
}
