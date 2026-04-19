import { describe, expect, it } from "vitest";
import {
	mergeFrontmatter,
	splitMarkdownFrontmatter,
} from "../../src/webview/frontmatter";

describe("splitMarkdownFrontmatter", () => {
	it("returns the original body when the document has no leading frontmatter", () => {
		expect(splitMarkdownFrontmatter("# Hanshi")).toEqual({
			body: "# Hanshi",
		});
	});

	it("extracts summary entries from YAML frontmatter", () => {
		const result = splitMarkdownFrontmatter(`---
title: Sample
status: draft
tags:
  - docs
  - specs
metadata:
  owner: daiki
---

# Body
`);

		expect(result.body).toBe("\n# Body\n");
		expect(result.frontmatter?.title).toBe("Sample");
		expect(result.frontmatter?.entries).toEqual([
			{ key: "title", value: "Sample" },
			{ key: "status", value: "draft" },
			{ key: "tags", value: "docs, specs" },
			{ key: "metadata", value: "owner: daiki" },
		]);
	});

	it("keeps raw YAML and surfaces parse errors", () => {
		const result = splitMarkdownFrontmatter(`---
title: [oops
---
`);

		expect(result.frontmatter?.raw).toContain("title: [oops");
		expect(result.frontmatter?.parseError).toBeDefined();
	});
});

describe("mergeFrontmatter", () => {
	it("recombines frontmatter and body without duplicating content", () => {
		const result = splitMarkdownFrontmatter(`---
title: Sample
---

# Body
`);

		expect(mergeFrontmatter(result.frontmatter?.block, result.body)).toBe(`---
title: Sample
---

# Body
`);
	});
});
