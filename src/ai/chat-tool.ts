import * as vscode from "vscode";
import { formatSelectionRef, HanshiEditorProvider } from "../provider";

export function registerChatTool(context: vscode.ExtensionContext): void {
	if (!vscode.lm?.registerTool) {
		return;
	}

	context.subscriptions.push(
		vscode.lm.registerTool("hanshi_getSelection", {
			async invoke(
				_options: vscode.LanguageModelToolInvocationOptions<
					Record<string, never>
				>,
				_token: vscode.CancellationToken,
			) {
				const sel = await HanshiEditorProvider.getSelection();

				if (!sel) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							"No text is currently selected in the Hanshi editor.",
						),
					]);
				}

				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						`Location: ${formatSelectionRef(sel)}\n\nSelected text:\n${sel.text}`,
					),
				]);
			},
		}),
	);
}
