import { parseProcessor } from "./markdown-parser";

interface OffsetPointLike {
	offset?: number | null;
}

interface PositionLike {
	start?: OffsetPointLike;
	end?: OffsetPointLike;
}

interface NodeLike {
	type: string;
	children?: NodeLike[];
	position?: PositionLike;
	checked?: boolean | null;
	depth?: number;
	lang?: string | null;
	meta?: string | null;
	ordered?: boolean;
	spread?: boolean;
	start?: number | null;
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

const CONTAINER_TYPES = new Set([
	"root",
	"blockquote",
	"list",
	"listItem",
	"footnoteDefinition",
]);

/**
 * Restores inter-block separators from a reference markdown string into a
 * normalized markdown string when both parse to the same block structure.
 *
 * remark-stringify tends to insert blank lines between sibling block nodes.
 * This preserves the original spacing between those nodes, including nested
 * structures such as blockquotes and list items.
 */
export function restoreBlankLineBoundaries(
	normalized: string,
	reference: string,
): string {
	const normTree = parseProcessor.parse(normalized) as NodeLike;
	const referenceTree = parseProcessor.parse(reference) as NodeLike;
	const replacements: Replacement[] = [];

	collectReplacements(
		referenceTree,
		reference,
		normTree,
		normalized,
		replacements,
	);

	if (replacements.length === 0) {
		return normalized;
	}

	let next = normalized;
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
		next =
			next.slice(0, replacement.start) +
			replacement.text +
			next.slice(replacement.end);
	}

	return next;
}

function collectReplacements(
	referenceNode: NodeLike,
	referenceMarkdown: string,
	normalizedNode: NodeLike,
	normalizedMarkdown: string,
	replacements: Replacement[],
): void {
	if (nodeSignature(referenceNode) !== nodeSignature(normalizedNode)) {
		return;
	}

	const referenceChildren = structuralChildren(referenceNode);
	const normalizedChildren = structuralChildren(normalizedNode);

	if (referenceChildren.length !== normalizedChildren.length) {
		return;
	}

	for (let index = 0; index < referenceChildren.length; index++) {
		if (
			nodeSignature(referenceChildren[index]) !==
			nodeSignature(normalizedChildren[index])
		) {
			return;
		}
	}

	for (let index = 0; index < referenceChildren.length - 1; index++) {
		const referenceEnd = endOffset(referenceChildren[index]);
		const referenceNextStart = startOffset(referenceChildren[index + 1]);
		const normalizedEnd = endOffset(normalizedChildren[index]);
		const normalizedNextStart = startOffset(normalizedChildren[index + 1]);

		if (
			referenceEnd === undefined ||
			referenceNextStart === undefined ||
			normalizedEnd === undefined ||
			normalizedNextStart === undefined
		) {
			continue;
		}

		const referenceSeparator = referenceMarkdown.slice(
			referenceEnd,
			referenceNextStart,
		);
		const normalizedSeparator = normalizedMarkdown.slice(
			normalizedEnd,
			normalizedNextStart,
		);

		if (referenceSeparator !== normalizedSeparator) {
			replacements.push({
				start: normalizedEnd,
				end: normalizedNextStart,
				text: referenceSeparator,
			});
		}
	}

	for (let index = 0; index < referenceChildren.length; index++) {
		collectReplacements(
			referenceChildren[index],
			referenceMarkdown,
			normalizedChildren[index],
			normalizedMarkdown,
			replacements,
		);
	}
}

function structuralChildren(node: NodeLike): NodeLike[] {
	if (!CONTAINER_TYPES.has(node.type) || !Array.isArray(node.children)) {
		return [];
	}

	return node.children;
}

function startOffset(node: NodeLike): number | undefined {
	const offset = node.position?.start?.offset;
	return typeof offset === "number" ? offset : undefined;
}

function endOffset(node: NodeLike): number | undefined {
	const offset = node.position?.end?.offset;
	return typeof offset === "number" ? offset : undefined;
}

function nodeSignature(node: NodeLike): string {
	switch (node.type) {
		case "heading":
			return `heading:${node.depth ?? ""}`;
		case "list":
			return `list:${node.ordered ? "ordered" : "unordered"}:${node.start ?? ""}:${node.spread ? "spread" : "tight"}`;
		case "listItem":
			return `listItem:${node.spread ? "spread" : "tight"}:${node.checked === null ? "unchecked-null" : String(node.checked)}`;
		case "code":
			return `code:${node.lang ?? ""}:${node.meta ?? ""}`;
		default:
			return node.type;
	}
}
