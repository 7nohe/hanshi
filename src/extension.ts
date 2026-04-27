import * as vscode from "vscode";
import { registerChatTool } from "./ai/chat-tool";
import { exportToPdf } from "./export/export-pdf";
import { HanshiOutlineProvider } from "./outline";
import {
	copySelectionRefToClipboard,
	formatSelectionRef,
	HanshiEditorProvider,
} from "./provider";
import type { HostToWebviewMessage } from "./shared/protocol";

export function activate(context: vscode.ExtensionContext): void {
	const provider = new HanshiEditorProvider(context);
	const outline = new HanshiOutlineProvider();
	outline.setTextSource(() => provider.getActiveDocumentText());

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			HanshiEditorProvider.viewType,
			provider,
			{
				supportsMultipleEditorsPerDocument: true,
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			},
		),
		vscode.commands.registerCommand("hanshi.open", async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor || editor.document.uri.scheme !== "file") {
				return;
			}

			await vscode.commands.executeCommand(
				"vscode.openWith",
				editor.document.uri,
				HanshiEditorProvider.viewType,
			);
		}),
		vscode.commands.registerCommand(
			"hanshi.copySelectionContext",
			copySelectionRefToClipboard,
		),
		vscode.commands.registerCommand("hanshi.sendSelectionToChat", async () => {
			const sel = await HanshiEditorProvider.getSelection();

			if (!sel) {
				void vscode.window.showInformationMessage(
					"No text selected in Hanshi editor.",
				);
				return;
			}

			const query = `${formatSelectionRef(sel)}\n\`\`\`\n${sel.text}\n\`\`\``;
			await vscode.commands.executeCommand("workbench.action.chat.open", {
				query,
			});
		}),
		vscode.commands.registerCommand("hanshi.revealHeading", (index: number) => {
			const webview = provider.getActiveWebview();
			if (webview) {
				void webview.postMessage({
					type: "revealHeading",
					index,
				} satisfies HostToWebviewMessage);
			}
		}),
		vscode.commands.registerCommand("hanshi.find", () => {
			const webview = provider.getActiveWebview();
			if (webview) {
				void webview.postMessage({
					type: "openSearch",
				} satisfies HostToWebviewMessage);
			}
		}),
		vscode.commands.registerCommand("hanshi.exportPdf", async () => {
			await exportToPdf(context, provider.getActiveDocument());
		}),
		vscode.window.createTreeView("hanshi.outline", {
			treeDataProvider: outline,
			showCollapseAll: true,
		}),
		provider.onDidChangeContent(() => outline.refresh()),
	);

	registerChatTool(context);
}

export function deactivate(): void {}
