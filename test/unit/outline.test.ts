import { describe, expect, it } from "vitest";
import { parseHeadings } from "../../src/shared/parse-headings";

describe("parseHeadings", () => {
	it("returns empty array for text with no headings", () => {
		expect(parseHeadings("Hello world\nSome text")).toEqual([]);
	});

	it("parses flat headings with sequential indices", () => {
		const result = parseHeadings("# A\n## B\n## C");
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("A");
		expect(result[0].index).toBe(0);
		expect(result[0].children).toHaveLength(2);
		expect(result[0].children[0]).toMatchObject({ name: "B", index: 1 });
		expect(result[0].children[1]).toMatchObject({ name: "C", index: 2 });
	});

	it("nests headings by level", () => {
		const result = parseHeadings("# Top\n## Sub\n### Deep\n## Sub2");
		expect(result).toHaveLength(1);
		const top = result[0];
		expect(top.children).toHaveLength(2);
		expect(top.children[0].name).toBe("Sub");
		expect(top.children[0].children[0].name).toBe("Deep");
		expect(top.children[1].name).toBe("Sub2");
	});

	it("handles multiple top-level headings", () => {
		const result = parseHeadings("# First\n# Second\n# Third");
		expect(result).toHaveLength(3);
		expect(result.map((h) => h.name)).toEqual(["First", "Second", "Third"]);
		expect(result.map((h) => h.index)).toEqual([0, 1, 2]);
	});

	it("skips frontmatter", () => {
		const md = "---\ntitle: Test\ndate: 2024-01-01\n---\n# Heading";
		const result = parseHeadings(md);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Heading");
		expect(result[0].index).toBe(0);
	});

	it("handles text with only frontmatter and no headings", () => {
		const md = "---\ntitle: Test\n---\nSome body text";
		expect(parseHeadings(md)).toEqual([]);
	});

	it("promotes a lower-level heading to root when no parent exists", () => {
		const result = parseHeadings("## Sub without parent\n# Top");
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			name: "Sub without parent",
			level: 2,
			index: 0,
		});
		expect(result[1]).toMatchObject({ name: "Top", level: 1, index: 1 });
	});
});
