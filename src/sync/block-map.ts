import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

interface PositionLike {
	start?: { offset?: number | null } | null;
	end?: { offset?: number | null } | null;
}

interface NodeLike {
	type?: string;
	position?: PositionLike | null;
	children?: NodeLike[];
}

export interface MarkdownBlock {
	index: number;
	type: string;
	start: number;
	end: number;
	text: string;
	segmentEnd: number;
	segmentText: string;
}

const parser = unified()
	.use(remarkParse)
	.use(remarkFrontmatter, ["yaml"])
	.use(remarkGfm)
	.use(remarkMath);

export function extractTopLevelBlocks(markdown: string): MarkdownBlock[] {
	const tree = parser.parse(markdown) as NodeLike;
	const children = tree.children ?? [];
	const blocks: MarkdownBlock[] = [];

	children.forEach((node, index) => {
		const start = node.position?.start?.offset;
		const end = node.position?.end?.offset;

		if (typeof start !== "number" || typeof end !== "number") {
			return;
		}

		const nextNode = children[index + 1];
		const nextStart = nextNode?.position?.start?.offset;
		const segmentEnd =
			typeof nextStart === "number" && nextStart >= end
				? nextStart
				: markdown.length;

		blocks.push({
			index,
			type: node.type ?? "unknown",
			start,
			end,
			text: markdown.slice(start, end),
			segmentEnd,
			segmentText: markdown.slice(start, segmentEnd),
		});
	});

	return blocks;
}
