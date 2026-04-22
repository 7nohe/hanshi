import { parseProcessor } from "./markdown-parser";

interface PositionLike {
	start?: { offset?: number | null };
	end?: { offset?: number | null };
}

interface NodeLike {
	type: string;
	url?: string;
	title?: string | null;
	value?: string;
	children?: NodeLike[];
	position?: PositionLike;
}

/**
 * Restores autolink angle brackets (`<url>`) that were stripped during
 * normalization.
 *
 * remark-gfm treats both `<https://example.com>` (autolink) and bare
 * `https://example.com` (GFM autolink literal) as identical `link` nodes
 * in the AST. The custom `stringifyLink` handler emits both forms as a
 * bare URL, losing the angle brackets. This post-processor compares the
 * reference source to detect where `<url>` was used and restores the
 * brackets in the normalized output.
 */
export function restoreAutolinkBrackets(
	normalized: string,
	reference: string,
): string {
	const refAutolinks = extractAutolinks(reference);
	if (refAutolinks.length === 0) return normalized;

	const normAutolinks = extractAutolinks(normalized);
	if (normAutolinks.length === 0) return normalized;

	const replacements: { start: number; end: number; text: string }[] = [];

	// Match autolinks by position order — both lists are in source order.
	let normIdx = 0;
	for (const ref of refAutolinks) {
		if (normIdx >= normAutolinks.length) break;
		const norm = normAutolinks[normIdx];

		// Only restore if the URLs match and the reference had brackets
		// but normalized does not.
		if (norm.url === ref.url && ref.hasBrackets && !norm.hasBrackets) {
			replacements.push({
				start: norm.start,
				end: norm.end,
				text: `<${norm.url}>`,
			});
			normIdx++;
		} else if (norm.url === ref.url) {
			// Same URL, both bare or both bracketed — skip.
			normIdx++;
		} else {
			// URLs diverged — structure may have changed, stop matching.
			break;
		}
	}

	if (replacements.length === 0) return normalized;

	// Apply replacements in reverse order to preserve offsets.
	let result = normalized;
	for (const r of replacements.sort((a, b) => b.start - a.start)) {
		result = result.slice(0, r.start) + r.text + result.slice(r.end);
	}
	return result;
}

interface AutolinkInfo {
	url: string;
	hasBrackets: boolean;
	start: number;
	end: number;
}

function extractAutolinks(markdown: string): AutolinkInfo[] {
	const tree = parseProcessor.parse(markdown) as NodeLike;
	const results: AutolinkInfo[] = [];
	collectAutolinks(tree, markdown, results);
	return results;
}

function collectAutolinks(
	node: NodeLike,
	source: string,
	results: AutolinkInfo[],
): void {
	if (
		node.type === "link" &&
		node.url &&
		!node.title &&
		node.children?.length === 1 &&
		node.children[0]?.type === "text" &&
		node.children[0].value === node.url &&
		/^[a-z][a-z+.-]+:/i.test(node.url)
	) {
		const start = node.position?.start?.offset;
		const end = node.position?.end?.offset;
		if (typeof start === "number" && typeof end === "number") {
			const raw = source.slice(start, end);
			results.push({
				url: node.url,
				hasBrackets: raw.startsWith("<") && raw.endsWith(">"),
				start,
				end,
			});
		}
	}

	if (node.children) {
		for (const child of node.children) {
			collectAutolinks(child, source, results);
		}
	}
}
