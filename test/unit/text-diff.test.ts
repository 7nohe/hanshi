import { describe, expect, it } from "vitest";
import { computeMinimalReplaceRange } from "../../src/sync/text-diff";

describe("computeMinimalReplaceRange", () => {
	it("returns undefined for equal text", () => {
		expect(computeMinimalReplaceRange("abc", "abc")).toBeUndefined();
	});

	it("finds a middle replacement", () => {
		expect(computeMinimalReplaceRange("hello world", "hello there")).toEqual({
			start: 6,
			end: 11,
			text: "there",
		});
	});

	it("finds an insertion", () => {
		expect(computeMinimalReplaceRange("abc", "abXc")).toEqual({
			start: 2,
			end: 2,
			text: "X",
		});
	});

	it("finds a deletion", () => {
		expect(computeMinimalReplaceRange("abXc", "abc")).toEqual({
			start: 2,
			end: 3,
			text: "",
		});
	});
});
