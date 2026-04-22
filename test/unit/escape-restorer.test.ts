import { describe, expect, it } from "vitest";
import { restoreEscapes } from "../../src/shared/escape-restorer";

describe("restoreEscapes", () => {
	it("restores backslash-escaped asterisks", () => {
		const reference = "- \\*asterisk\\*\n";
		const normalized = "- *asterisk*\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("restores backslash-escaped brackets", () => {
		const reference = "- \\[brackets\\]\n";
		const normalized = "- [brackets]\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("restores backslash-escaped backticks", () => {
		const reference = "- \\`backticks\\`\n";
		const normalized = "- `backticks`\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("restores multiple escapes across lines", () => {
		const reference =
			"- \\*asterisk\\*\n- \\[brackets\\]\n- \\`backticks\\`\n";
		const normalized =
			"- *asterisk*\n- [brackets]\n- \\`backticks\\`\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("does not modify lines that have no escapes in the reference", () => {
		const reference = "Normal text\n";
		const normalized = "Normal text\n";
		expect(restoreEscapes(normalized, reference)).toBe(normalized);
	});

	it("does not modify when line counts differ", () => {
		const reference = "line1\nline2\n";
		const normalized = "line1\n";
		expect(restoreEscapes(normalized, reference)).toBe(normalized);
	});

	it("does not restore when stripped reference does not match normalized", () => {
		const reference = "\\*different\\*\n";
		const normalized = "something else\n";
		expect(restoreEscapes(normalized, reference)).toBe(normalized);
	});

	it("restores escaped hash marks", () => {
		const reference = "\\# Not a heading\n";
		const normalized = "# Not a heading\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("restores escaped exclamation marks", () => {
		const reference = "\\!important\n";
		const normalized = "!important\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("handles mixed escaped and non-escaped content on same line", () => {
		const reference = "Literal \\*stars\\* and normal *emphasis*\n";
		// After normalization the escaped stars are lost but emphasis is kept.
		// The stripped reference equals the normalized line, so escapes are restored.
		const normalized = "Literal *stars* and normal *emphasis*\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("preserves backslash that is not an escape (e.g. \\n in text)", () => {
		const reference = "Use \\n for newline\n";
		const normalized = "Use \\n for newline\n";
		// \n is not an ASCII punctuation escape, so nothing to restore
		expect(restoreEscapes(normalized, reference)).toBe(normalized);
	});

	it("restores escaped pipes", () => {
		const reference = "Use \\| for pipe\n";
		const normalized = "Use | for pipe\n";
		expect(restoreEscapes(normalized, reference)).toBe(reference);
	});

	it("returns normalized unchanged when no escapes differ", () => {
		const text = "- item one\n- item two\n";
		expect(restoreEscapes(text, text)).toBe(text);
	});
});
