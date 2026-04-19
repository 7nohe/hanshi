export function createImageMarkdown(alt: string, path: string): string {
	const escapedAlt = alt.replace(/\]/g, "\\]");
	return `![${escapedAlt}](${path})`;
}
