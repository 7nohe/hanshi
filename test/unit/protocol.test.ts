import { describe, expect, it } from "vitest";
import {
	isHostToWebviewMessage,
	isWebviewToHostMessage,
} from "../../src/shared/protocol";

describe("isHostToWebviewMessage", () => {
	it("recognises setFont messages", () => {
		expect(
			isHostToWebviewMessage({
				type: "setFont",
				fontFamily: "Arial",
				titleFontFamily: "",
			}),
		).toBe(true);
	});

	it("recognises init messages with font fields", () => {
		expect(
			isHostToWebviewMessage({
				type: "init",
				markdown: "",
				version: 1,
				editable: true,
				completionsEnabled: true,
				fontFamily: "",
				titleFontFamily: "",
			}),
		).toBe(true);
	});

	it("rejects unknown types", () => {
		expect(isHostToWebviewMessage({ type: "unknown" })).toBe(false);
	});

	it("rejects non-objects", () => {
		expect(isHostToWebviewMessage(null)).toBe(false);
		expect(isHostToWebviewMessage("setFont")).toBe(false);
	});
});

describe("isWebviewToHostMessage", () => {
	it("rejects host-only message types", () => {
		expect(isWebviewToHostMessage({ type: "setFont" })).toBe(false);
	});
});
