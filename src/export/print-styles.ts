export const PRINT_STYLES = `
:root {
	color-scheme: light;
}

* {
	box-sizing: border-box;
}

html, body {
	margin: 0;
	padding: 0;
	background: white;
	color: #1a1a1a;
}

body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
		Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
	font-size: 11pt;
	line-height: 1.7;
	padding: 24mm 22mm;
	max-width: 210mm;
	margin: 0 auto;
}

h1, h2, h3, h4, h5, h6 {
	margin: 1.6em 0 0.6em;
	line-height: 1.3;
	page-break-after: avoid;
}

h1 { font-size: 1.9em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.15em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.1em; }

p, ul, ol, blockquote, pre, table {
	margin: 0 0 0.9em;
}

p { orphans: 3; widows: 3; }

ul, ol { padding-left: 1.6em; }

li > p { margin: 0.2em 0; }

a {
	color: #0d4ea3;
	text-decoration: underline;
	word-break: break-word;
}

blockquote {
	margin: 0 0 0.9em;
	padding: 0.4em 1em;
	color: #555;
	border-left: 3px solid #ccc;
	background: #f8f8f8;
}

code {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
		"Liberation Mono", monospace;
	font-size: 0.92em;
	background: #f3f3f3;
	padding: 0.1em 0.35em;
	border-radius: 3px;
}

pre {
	background: #f6f8fa;
	border: 1px solid #e1e4e8;
	border-radius: 4px;
	padding: 0.8em 1em;
	overflow: visible;
	white-space: pre-wrap;
	word-break: break-word;
	page-break-inside: avoid;
}

pre code {
	background: none;
	padding: 0;
	border-radius: 0;
	font-size: 0.88em;
}

img {
	max-width: 100%;
	height: auto;
	page-break-inside: avoid;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.95em;
	page-break-inside: avoid;
}

th, td {
	border: 1px solid #ddd;
	padding: 6px 10px;
	text-align: left;
	vertical-align: top;
}

th {
	background: #f2f2f2;
	font-weight: 600;
}

hr {
	border: 0;
	border-top: 1px solid #ddd;
	margin: 1.6em 0;
}

input[type="checkbox"] {
	margin-right: 0.4em;
}

math {
	font-size: 1.05em;
}

math[display="block"] {
	display: block;
	margin: 0.6em 0;
	text-align: center;
}

.hanshi-print-mermaid {
	margin: 1em 0;
	text-align: center;
	page-break-inside: avoid;
}

.hanshi-print-mermaid svg {
	max-width: 100%;
	height: auto;
}

@page {
	size: A4;
	margin: 18mm 16mm;
}

@media print {
	body {
		padding: 0;
		max-width: none;
	}
}

#hanshi-print-toolbar {
	position: fixed;
	top: 12px;
	right: 12px;
	display: flex;
	gap: 8px;
	z-index: 1000;
	background: rgba(255, 255, 255, 0.95);
	padding: 8px 10px;
	border: 1px solid #ddd;
	border-radius: 6px;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

#hanshi-print-toolbar button {
	font: inherit;
	padding: 4px 12px;
	border: 1px solid #bbb;
	border-radius: 4px;
	background: white;
	cursor: pointer;
}

#hanshi-print-toolbar button:hover {
	background: #f4f4f4;
}

@media print {
	#hanshi-print-toolbar { display: none; }
}
`;
