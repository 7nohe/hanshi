import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { escapeHtml } from "../shared/html-utils";
import { renderMarkdownToHtml } from "./markdown-to-html";
import { PRINT_STYLES } from "./print-styles";

const MERMAID_CLASS_RE = /class="(?:[^"]*\s)?language-(?:mermaid|mmd)(?:\s[^"]*)?"/;

export interface ExportSource {
	uri: vscode.Uri;
	getText(): string;
}

export async function exportToPdf(
	context: vscode.ExtensionContext,
	source: ExportSource | undefined,
): Promise<void> {
	if (!source) {
		void vscode.window.showInformationMessage(
			"Open a Markdown file in Hanshi before exporting to PDF.",
		);
		return;
	}

	const documentDir = path.dirname(source.uri.fsPath);
	const documentName =
		path.basename(source.uri.fsPath, path.extname(source.uri.fsPath)) ||
		"document";

	const body = renderMarkdownToHtml(source.getText(), {
		resolveImageSrc: (src) => resolveImageSrcAsFileUri(src, documentDir),
	});

	const rendererUri = MERMAID_CLASS_RE.test(body)
		? vscode.Uri.file(
				path.join(context.extensionUri.fsPath, "dist", "export", "index.js"),
			).toString()
		: undefined;

	const html = buildBrowserHtml(body, rendererUri, documentName);

	const tempDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "hanshi-print-"),
	);
	const tempHtmlPath = path.join(
		tempDir,
		`${sanitizeFilename(documentName)}.html`,
	);
	await fs.promises.writeFile(tempHtmlPath, html, "utf8");

	await vscode.env.openExternal(vscode.Uri.file(tempHtmlPath));
}

function buildBrowserHtml(
	body: string,
	rendererUri: string | undefined,
	title: string,
): string {
	const escapedTitle = escapeHtml(title);
	const rendererTag = rendererUri ? `<script src="${rendererUri}"></script>` : "";
	const inlinePrint = rendererUri
		? ""
		: `<script>window.addEventListener('load', () => { document.getElementById('hanshi-print-button')?.addEventListener('click', () => window.print()); window.print(); });</script>`;

	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapedTitle}</title>
    <style>${PRINT_STYLES}</style>
  </head>
  <body>
    <div id="hanshi-print-toolbar">
      <button id="hanshi-print-button" type="button">Print / Save as PDF</button>
    </div>
    <main id="hanshi-print-content">${body}</main>
    ${rendererTag}${inlinePrint}
  </body>
</html>`;
}

function resolveImageSrcAsFileUri(src: string, documentDir: string): string {
	if (/^(?:[a-z]+:)?\/\//i.test(src) || /^(?:data|blob):/i.test(src)) {
		return src;
	}

	const target = path.isAbsolute(src) ? src : path.resolve(documentDir, src);

	if (
		!path.isAbsolute(src) &&
		!target.startsWith(documentDir + path.sep) &&
		target !== documentDir
	) {
		return src;
	}

	return vscode.Uri.file(target).toString();
}

function sanitizeFilename(value: string): string {
	const sanitized = value
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return sanitized || "document";
}

