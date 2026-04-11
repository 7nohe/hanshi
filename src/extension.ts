import * as vscode from 'vscode';
import { HanshiEditorProvider } from './provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HanshiEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HanshiEditorProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.commands.registerCommand('hanshi.open', async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor || editor.document.uri.scheme !== 'file') {
        return;
      }

      await vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        HanshiEditorProvider.viewType,
      );
    }),
  );
}

export function deactivate(): void {}
