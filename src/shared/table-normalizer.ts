/**
 * Restores table separator rows from a reference markdown into a
 * normalized markdown string.
 *
 * remark-gfm with `tablePipeAlign: false` shortens separator dashes
 * to the minimum (1 dash). Instead of forcing a specific dash count,
 * this restores whatever the reference markdown originally had.
 */
export function restoreTableSeparators(
	normalized: string,
	reference: string,
): string {
	const refSeparators = extractSeparatorRows(reference);
	if (refSeparators.length === 0) return normalized;

	let separatorIndex = 0;
	const lines = normalized.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (isSeparatorRow(lines[i]) && separatorIndex < refSeparators.length) {
			const normCols = columnAlignments(lines[i]);
			const refCols = columnAlignments(refSeparators[separatorIndex]);
			if (
				normCols.length === refCols.length &&
				normCols.every((a, j) => a === refCols[j])
			) {
				lines[i] = refSeparators[separatorIndex];
			}
			separatorIndex++;
		}
	}
	return lines.join("\n");
}

const SEPARATOR_RE = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/;

function isSeparatorRow(line: string): boolean {
	return SEPARATOR_RE.test(line.trim());
}

function extractSeparatorRows(markdown: string): string[] {
	return markdown.split("\n").filter(isSeparatorRow);
}

type Alignment = "left" | "right" | "center" | "none";

function columnAlignments(separatorRow: string): Alignment[] {
	return separatorRow
		.trim()
		.replace(/^\||\|$/g, "")
		.split("|")
		.map((cell) => {
			const c = cell.trim();
			const left = c.startsWith(":");
			const right = c.endsWith(":");
			if (left && right) return "center";
			if (right) return "right";
			if (left) return "left";
			return "none";
		});
}
