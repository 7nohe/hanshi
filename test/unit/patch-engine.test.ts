import { describe, expect, it } from "vitest";
import {
	computeBlockReplaceRange,
	computeReplaceRange,
} from "../../src/sync/block-diff";
import {
	normalizeMarkdown,
	safeNormalizeMarkdown,
} from "../../src/sync/markdown-normalizer";

describe("normalizeMarkdown", () => {
	it("normalizes list markers and adds a trailing newline", () => {
		const input = "* one\n* two";
		expect(normalizeMarkdown(input)).toBe("- one\n- two\n");
	});

	it("preserves CJK content", () => {
		const input = "# 見出し\n\n日本語の段落です。";
		expect(normalizeMarkdown(input)).toContain("日本語の段落です。");
	});

	it("is idempotent — normalizing twice produces the same result", () => {
		const inputs = [
			"* one\n* two",
			"# Title\n\n__bold__ and _italic_\n\n~~~js\ncode\n~~~\n",
			"---\ntitle: hello\n---\n\n+ item\n  + nested\n",
			"> quote\n>\n> continued\n\n***\n",
			"1.  first\n2.  second\n",
			"| H1 | H2 |\n| :--- | :--- |\n| a | b |\n",
			"- [x] done\n- [ ] todo\n",
			"- tight 1\n- tight 2\n  - nested\n",
			"- loose 1\n\n- loose 2\n",
			"an autolink <https://example.com/docs>\n",
			"bare https://example.com and <https://other.com>\n",
			"- \\*asterisk\\*\n- \\[brackets\\]\n- \\`backticks\\`\n",
		];

		for (const input of inputs) {
			const first = normalizeMarkdown(input);
			const second = normalizeMarkdown(first);
			expect(second).toBe(first);
		}
	});

	it("does not pad table columns to align pipes", () => {
		const input =
			"| hoge | fuga | foo |\n| :--- | :--- | :--- |\n| baa | long text | 2 |\n| 3 | 4 | 5 |\n";
		const result = normalizeMarkdown(input);
		expect(result).not.toMatch(/\| baa {2,}/);
	});

	it("preserves original table separator dash counts", () => {
		const threeHash =
			"| left | center | right |\n| :--- | :---: | ---: |\n| a | b | c |\n";
		expect(normalizeMarkdown(threeHash)).toBe(threeHash);

		const singleDash =
			"| Area | Status |\n| - | - |\n| Sync | Done |\n";
		expect(normalizeMarkdown(singleDash)).toBe(singleDash);
	});

	it("preserves literal underscores in table cells", () => {
		const input =
			"| Name | Value |\n| --- | --- |\n| real_world | test |\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves literal intraword underscores in paragraph text", () => {
		const input = "real_world and foo__bar\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves literal asterisks in paragraph text", () => {
		const input = "2 * 3 = 6\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves literal left brackets in paragraph text", () => {
		const input = "array[0] = 1\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves literal dollar signs in paragraph text", () => {
		const input = "Price: $100\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("continues to render emphasis, strong, links, and math correctly", () => {
		const input = "*italic* **bold** [text](https://example.com) $E=mc^2$\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves plain URLs without autolink angle brackets", () => {
		const input = "Visit https://example.com for info\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves autolink angle brackets", () => {
		const input = "an autolink <https://example.com/docs>\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves multiple autolinks with angle brackets", () => {
		const input =
			"See <https://example.com> and <https://other.com/path>\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves mixed bare URLs and autolinks", () => {
		const input =
			"Bare https://example.com and autolink <https://other.com>\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves tight list tightness", () => {
		const tight = "- one\n- two\n- three\n";
		expect(normalizeMarkdown(tight)).toBe(tight);
	});

	it("preserves loose list tightness", () => {
		const loose = "- one\n\n- two\n\n- three\n";
		expect(normalizeMarkdown(loose)).toBe(loose);
	});

	it("preserves a list followed immediately by a heading and paragraph", () => {
		const input =
			"3. Finish with a concluding item.\n## Escaping\nLiteral characters that often need escaping:\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves a heading followed immediately by a paragraph", () => {
		const input = "## Escaping\nLiteral characters that often need escaping:\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves code fences immediately before and after text", () => {
		const input = "Before\n```ts\nconst value = 1;\n```\nAfter\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves text immediately before a blockquote", () => {
		const input = "Before\n> quoted\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves a blockquote immediately before a heading", () => {
		const input = "> quoted\n## After\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves existing blank lines between block nodes", () => {
		const input = "# Heading\n\nParagraph\n\n> quote\n\n```ts\nconst value = 1;\n```\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves URL with underscores in plain text", () => {
		const input = "See https://example.com/real_world_test page\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves link text with underscores", () => {
		const input = "[real_world](https://example.com)\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves reference links", () => {
		const input = "[text][ref]\n\n[ref]: https://example.com\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves images", () => {
		const input = "![alt text](image.png)\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves inline code", () => {
		const input = "Use `code` here\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves inline HTML", () => {
		const input = "This is <strong>bold</strong> text\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves block HTML", () => {
		const input = "<div>\ntest\n</div>\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves nested lists", () => {
		const input = "- a\n  - b\n  - c\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves task lists", () => {
		const input = "- [x] done\n- [ ] todo\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves blockquotes", () => {
		const input = "> quoted text\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves math block", () => {
		const input = "$$\nE=mc^2\n$$\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves YAML frontmatter", () => {
		const input = "---\ntitle: Test\n---\n\nContent\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves paragraph then list without blank line", () => {
		const input = "Text\n- item\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves consecutive headings without blank lines", () => {
		const input = "# H1\n## H2\n### H3\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves mixed escaping scenarios", () => {
		const input = "*em* and real_world and $100\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves explicit backslash escapes for asterisks", () => {
		const input = "- \\*asterisk\\*\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves explicit backslash escapes for brackets", () => {
		const input = "- \\[brackets\\]\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves explicit backslash escapes for backticks", () => {
		const input = "- \\`backticks\\`\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves all explicit backslash escapes in a list", () => {
		const input =
			"- \\*asterisk\\*\n- \\[brackets\\]\n- \\`backticks\\`\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("preserves escaped punctuation in paragraph text", () => {
		const input = "Literal \\*stars\\* and \\[brackets\\] here\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("does not alter lines without escapes when restoring", () => {
		const input =
			"Normal text\n- \\*escaped\\*\n- plain item\n";
		expect(normalizeMarkdown(input)).toBe(input);
	});

	it("restores explicit backslash escapes from reference markdown", () => {
		const reference =
			"- \\*asterisk\\*\n- \\[brackets\\]\n- \\`backticks\\`\n";
		// Simulate what the webview might send after re-serialization
		const edited =
			"- *asterisk*\n- [brackets]\n- \\`backticks\\`\n";

		const result = safeNormalizeMarkdown(edited, { reference });

		expect(result.didFallback).toBe(false);
		expect(result.markdown).toBe(reference);
	});

	it("restores table separator dash counts from reference markdown", () => {
		const reference =
			"| left | center | right |\n| :--- | :---: | ---: |\n| a | b | c |\n";
		// Simulate what Milkdown/remark might shorten separators to
		const edited =
			"| left | center | right |\n| :- | :-: | -: |\n| alpha | beta | gamma |\n";

		const result = safeNormalizeMarkdown(edited, { reference });

		expect(result.didFallback).toBe(false);
		// Separators should be restored to match the reference's dash counts
		expect(result.markdown).toContain("| :--- | :---: | ---: |");
	});

	it("falls back to raw markdown when normalization throws", () => {
		const result = safeNormalizeMarkdown("abc", {
			processor: {
				parse() {
					throw new Error("boom");
				},
				stringify() {
					return "";
				},
			},
		});

		expect(result.didFallback).toBe(true);
		expect(result.markdown).toBe("abc\n");
		expect(result.warning).toContain("normalization failed");
	});
});

describe("computeReplaceRange", () => {
	it("replaces a single changed top-level block span", () => {
		const current = "# Title\n\nOne\n\nTwo\n";
		const next = "# Title\n\nChanged\n\nTwo\n";
		expect(computeBlockReplaceRange(current, next)).toEqual({
			start: 9,
			end: 14,
			text: "Changed\n\n",
		});
	});

	it("falls back when changed blocks are non-contiguous", () => {
		const current = "# A\n\nOne\n\nTwo\n";
		const next = "# B\n\nOne\n\nThree\n";
		expect(computeBlockReplaceRange(current, next)).toBeUndefined();
		expect(computeReplaceRange(current, next)).toBeDefined();
	});
});
