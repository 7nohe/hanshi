import type { Element, Root as HastRoot } from "hast";
import type { Schema } from "hast-util-sanitize";
import { visit } from "unist-util-visit";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export interface RenderOptions {
	resolveImageSrc: (src: string) => string;
}

const sanitizeSchema: Schema = {
	...defaultSchema,
	protocols: {
		...defaultSchema.protocols,
		src: ["http", "https", "file", "data"],
		href: [...(defaultSchema.protocols?.href ?? []), "file"],
	},
};

function rehypeRewriteImages(resolveImageSrc: (src: string) => string) {
	return () =>
		(tree: HastRoot) => {
			visit(tree, "element", (node: Element) => {
				if (node.tagName !== "img") return;
				const src = node.properties?.src;
				if (typeof src !== "string" || !src) return;
				try {
					node.properties = {
						...node.properties,
						src: resolveImageSrc(src),
					};
				} catch {
					// Leave the original src in place if resolution fails.
				}
			});
		};
}

export function renderMarkdownToHtml(
	markdown: string,
	options: RenderOptions,
): string {
	const processor = unified()
		.use(remarkParse)
		.use(remarkFrontmatter, ["yaml"])
		.use(remarkGfm)
		.use(remarkMath)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeRewriteImages(options.resolveImageSrc))
		.use(rehypeSanitize, sanitizeSchema)
		.use(rehypeKatex, { output: "mathml" })
		.use(rehypeStringify);

	return processor.processSync(markdown).toString();
}
