import * as vscode from 'vscode';
import { registerChatTool } from './ai/chat-tool';
import { copySelectionRefToClipboard, formatSelectionRef, HanshiEditorProvider } from './provider';

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
    vscode.commands.registerCommand('hanshi.copySelectionContext', copySelectionRefToClipboard),
    vscode.commands.registerCommand('hanshi.sendSelectionToChat', async () => {
      const sel = await HanshiEditorProvider.getSelection();

      if (!sel) {
        void vscode.window.showInformationMessage('No text selected in Hanshi editor.');
        return;
      }

      const query = `${formatSelectionRef(sel)}\n\`\`\`\n${sel.text}\n\`\`\``;
      await vscode.commands.executeCommand('workbench.action.chat.open', { query });
    }),
  );

  registerChatTool(context);
}

export function deactivate(): void {}
