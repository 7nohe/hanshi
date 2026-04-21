import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { defaultHandlers } from "mdast-util-to-markdown";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Link, Parents, Text } from "mdast";
import type { Info, State } from "mdast-util-to-markdown";
import { unified } from "unified";
import { restoreBlankLineBoundaries } from "../shared/blank-line-restorer";
import { restoreTableSeparators } from "../shared/table-normalizer";

// Private-use sentinels that protect literal characters from remark's escaping.
const SENTINELS: Record<string, string> = {
	_: "\uE000",
	"*": "\uE001",
	"[": "\uE002",
	$: "\uE003",
};
const INTRAWORD_UNDERSCORE_RE =
	/(?<=[\p{Letter}\p{Number}])(_+)(?=[\p{Letter}\p{Number}])/gu;
const PROTECT_RE = /[*[$]/g;
const RESTORE_RE = /[\uE000\uE001\uE002\uE003]/g;

const processor = unified()
	.use(remarkParse)
	.use(remarkFrontmatter, ["yaml"])
	.use(remarkGfm, { tablePipeAlign: false })
	.use(remarkMath)
	.use(remarkStringify, {
		bullet: "-",
		emphasis: "*",
		strong: "*",
		fence: "`",
		fences: true,
		handlers: {
			link: stringifyLink,
			text: stringifyText,
		},
		listItemIndent: "one",
		rule: "-",
	});

export interface MarkdownProcessorLike {
	// biome-ignore lint/suspicious/noExplicitAny: generic processor contract
	parse(markdown: string): any;
	// biome-ignore lint/suspicious/noExplicitAny: generic processor contract
	stringify(tree: any): string;
}

export interface NormalizationResult {
	markdown: string;
	didFallback: boolean;
	warning?: string;
}

export function normalizeMarkdown(
	markdown: string,
	reference?: string,
): string {
	let next = processor.stringify(processor.parse(markdown));
	next = next.endsWith("\n") ? next : `${next}\n`;
	return restoreFormatting(next, reference ?? markdown);
}

export function safeNormalizeMarkdown(
	markdown: string,
	options?: { processor?: MarkdownProcessorLike; reference?: string },
): NormalizationResult {
	const proc = options?.processor ?? processor;
	try {
		let next = proc.stringify(proc.parse(markdown));
		next = next.endsWith("\n") ? next : `${next}\n`;
		return {
			markdown: restoreFormatting(next, options?.reference ?? markdown),
			didFallback: false,
		};
	} catch (error) {
		return {
			markdown: ensureTrailingNewline(markdown),
			didFallback: true,
			warning: createNormalizationWarning(error),
		};
	}
}

function restoreFormatting(normalized: string, reference: string): string {
	return restoreTableSeparators(
		restoreBlankLineBoundaries(normalized, reference),
		reference,
	);
}

function ensureTrailingNewline(markdown: string): string {
	return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function createNormalizationWarning(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	return `Hanshi fell back to raw Markdown because normalization failed: ${detail}`;
}

function stringifyText(
	node: Text,
	_: Parents | undefined,
	state: State,
	info: Info,
): string {
	if (
		!node.value.includes("_") &&
		!node.value.includes("*") &&
		!node.value.includes("[") &&
		!node.value.includes("$")
	) {
		return state.safe(node.value, info);
	}

	// Underscores need conditional protection: only intraword runs (e.g.
	// `real_world`) are literal — `_italic_` must stay escapable.
	let v = node.value.replace(INTRAWORD_UNDERSCORE_RE, (match) =>
		SENTINELS._.repeat(match.length),
	);
	// `*`, `[`, and `$` inside a text node are always literal because remark
	// parses their syntactic uses (emphasis, links, math) into dedicated node
	// types — so unconditional replacement is safe here.
	v = v.replace(PROTECT_RE, (ch) => SENTINELS[ch]);

	return state
		.safe(v, info)
		.replace(RESTORE_RE, (ch) => RESTORE_MAP[ch]);
}

const RESTORE_MAP: Record<string, string> = {
	[SENTINELS._]: "_",
	[SENTINELS["*"]]: "*",
	[SENTINELS["["]]: "[",
	[SENTINELS.$]: "$",
};

function stringifyLink(
	node: Link,
	_: Parents | undefined,
	state: State,
	info: Info,
): string {
	if (
		node.url &&
		!node.title &&
		node.children.length === 1 &&
		node.children[0]?.type === "text" &&
		node.children[0].value === node.url &&
		/^[a-z][a-z+.-]+:/i.test(node.url) &&
		!/[\0- <>\u007F]/.test(node.url)
	) {
		return node.url;
	}

	return defaultHandlers.link(node, _, state, info);
}
