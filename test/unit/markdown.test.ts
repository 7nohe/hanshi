import { describe, expect, it } from "vitest";
import { createImageMarkdown } from "../../src/webview/markdown";

describe("createImageMarkdown", () => {
	it("builds markdown image syntax", () => {
		expect(createImageMarkdown("diagram", "assets/diagram.png")).toBe(
			"![diagram](assets/diagram.png)",
		);
	});

	it("escapes closing brackets in alt text", () => {
		expect(createImageMarkdown("a]b", "assets/img.png")).toBe(
			"![a\\]b](assets/img.png)",
		);
	});
});
