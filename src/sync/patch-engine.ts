import * as vscode from 'vscode';
import { normalizeMarkdown } from './markdown-normalizer';

export function getFullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLineIndex = Math.max(document.lineCount - 1, 0);
  const lastLine = document.lineAt(lastLineIndex);
  return new vscode.Range(0, 0, lastLineIndex, lastLine.text.length);
}

export function createFullDocumentEdit(
  document: vscode.TextDocument,
  markdown: string,
): vscode.WorkspaceEdit | undefined {
  const next = normalizeMarkdown(markdown);

  if (document.getText() === next) {
    return undefined;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, getFullDocumentRange(document), next);
  return edit;
}
