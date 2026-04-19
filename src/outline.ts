import * as vscode from "vscode";
import { type HeadingItem, parseHeadings } from "./shared/parse-headings";

export type { HeadingItem };

export class HanshiOutlineProvider
	implements vscode.TreeDataProvider<HeadingItem>
{
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private headings: HeadingItem[] = [];
	private getText: (() => string | undefined) | undefined;

	setTextSource(getText: () => string | undefined): void {
		this.getText = getText;
	}

	refresh(): void {
		this.headings = this.getText ? parseHeadings(this.getText() ?? "") : [];
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: HeadingItem): vscode.TreeItem {
		const item = new vscode.TreeItem(
			element.name,
			element.children.length > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		item.command = {
			command: "hanshi.revealHeading",
			title: "Reveal Heading",
			arguments: [element.index],
		};
		item.iconPath = new vscode.ThemeIcon("symbol-text");
		return item;
	}

	getChildren(element?: HeadingItem): HeadingItem[] {
		return element ? element.children : this.headings;
	}

	dispose(): void {
		this._onDidChangeTreeData.dispose();
	}
}
