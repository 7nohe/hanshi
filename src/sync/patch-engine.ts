import * as vscode from 'vscode';
import { computeReplaceRange } from './block-diff';
import { safeNormalizeMarkdown } from './markdown-normalizer';

export interface PatchEngineResult {
  edit?: vscode.WorkspaceEdit;
  warning?: string;
}

export function getFullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLineIndex = Math.max(document.lineCount - 1, 0);
  const lastLine = document.lineAt(lastLineIndex);
  return new vscode.Range(0, 0, lastLineIndex, lastLine.text.length);
}

export function createFullDocumentEdit(
  document: vscode.TextDocument,
  markdown: string,
): PatchEngineResult {
  const result = safeNormalizeMarkdown(markdown);
  const next = result.markdown;

  if (document.getText() === next) {
    return {
      warning: result.warning,
    };
  }

  const replaceRange = computeReplaceRange(document.getText(), next);

  if (!replaceRange) {
    return {
      warning: result.warning,
    };
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(replaceRange.start), document.positionAt(replaceRange.end)),
    replaceRange.text,
  );
  return {
    edit,
    warning: result.warning,
  };
}
