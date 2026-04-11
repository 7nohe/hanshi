import * as path from 'node:path';
import * as vscode from 'vscode';
import { DocumentSync } from './sync/document-sync';
import type { DropImageMessage, HostToWebviewMessage, WebviewToHostMessage } from './shared/protocol';

export class HanshiEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'hanshi.markdownEditor';

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
          case 'dropImage':
            await this.handleDropImage(document, message, webview);
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
      sync.dispose();
    });
  }

  private async handleDropImage(
    document: vscode.TextDocument,
    message: DropImageMessage,
    webview: vscode.Webview,
  ): Promise<void> {
    const match = message.dataUrl.match(/^data:(.+);base64,(.+)$/);

    if (!match) {
      throw new Error('Dropped image payload is not a valid data URL.');
    }

    const [, mime, base64] = match;
    const bytes = Buffer.from(base64, 'base64');
    const extension = mime.split('/')[1] ?? 'png';
    const parsed = path.parse(message.name);
    const safeBaseName = parsed.name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-');
    const assetDirectory = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(document.uri.fsPath)), 'assets');
    await vscode.workspace.fs.createDirectory(assetDirectory);

    const fileName = `${safeBaseName || 'image'}-${Date.now()}.${extension}`;
    const imageUri = vscode.Uri.joinPath(assetDirectory, fileName);

    await vscode.workspace.fs.writeFile(imageUri, bytes);

    const relativePath = path.relative(path.dirname(document.uri.fsPath), imageUri.fsPath).split(path.sep).join('/');
    await webview.postMessage({
      type: 'imageInserted',
      alt: parsed.name || 'image',
      path: relativePath,
    } satisfies HostToWebviewMessage);
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Hanshi</title>
  </head>
  <body>
    <div id="app">
      <div id="editor"></div>
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
