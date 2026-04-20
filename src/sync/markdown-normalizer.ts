import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

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
		listItemIndent: "one",
		rule: "-",
	});

export interface MarkdownProcessorLike {
	parse(markdown: string): unknown;
	stringify(tree: unknown): string;
}

export interface NormalizationResult {
	markdown: string;
	didFallback: boolean;
	warning?: string;
}

export function normalizeMarkdown(markdown: string): string {
	const tree = processor.parse(markdown);
	const next = processor.stringify(tree);
	return next.endsWith("\n") ? next : `${next}\n`;
}

export function safeNormalizeMarkdown(
	markdown: string,
	currentProcessor: MarkdownProcessorLike = processor,
): NormalizationResult {
	try {
		const tree = currentProcessor.parse(markdown);
		const next = currentProcessor.stringify(tree);
		return {
			markdown: next.endsWith("\n") ? next : `${next}\n`,
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

function ensureTrailingNewline(markdown: string): string {
	return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function createNormalizationWarning(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	return `Hanshi fell back to raw Markdown because normalization failed: ${detail}`;
}
