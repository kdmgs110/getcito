import { describe, expect, it } from "vitest";
import { measurementSurface, measurementTargetKey, measurementTargetLabel, safeEvidenceUrl } from "./measurement";

describe("measurement identity", () => {
	it("separates browser surfaces from API responses and unknown historical sources", () => {
		expect(measurementSurface("chatgpt", "brightdata")).toBe("chatgpt_web");
		expect(measurementSurface("chatgpt", "openai-api")).toBe("llm_api");
		expect(measurementSurface("chatgpt", "dataforseo")).toBe("llm_api");
		expect(measurementSurface("google-ai-overview", "brightdata")).toBe("google_ai_overview");
		expect(measurementSurface("google-ai-mode", "dataforseo")).toBe("google_ai_mode");
		expect(measurementSurface("chatgpt", null)).toBe("unknown");
		expect(measurementSurface("chatgpt", "unrecognized")).toBe("unknown");
		expect(measurementTargetLabel("chatgpt", "openai-api")).toBe("ChatGPT API");
	});

	it("uses requested version and search mode as acquisition identity", () => {
		expect(
			measurementTargetKey({ model: "chatgpt", provider: "brightdata", version: "gd_custom", webSearch: true }),
		).toBe("chatgpt:brightdata:gd_custom:online");
		expect(measurementTargetKey({ model: "chatgpt", provider: "brightdata", webSearch: false })).toBe(
			"chatgpt:brightdata",
		);
	});
});

describe("evidence links", () => {
	it("retains full paths and queries for safe HTTP links", () => {
		expect(safeEvidenceUrl("https://example.com/path?q=1#source")).toBe("https://example.com/path?q=1#source");
	});
	it.each([
		"javascript:alert(1)",
		"data:text/html,test",
		"file:///etc/passwd",
		"https://user:secret@example.com/",
		"/relative",
		null,
	])("rejects unsafe or non-absolute links: %s", (value) => {
		expect(safeEvidenceUrl(value)).toBeNull();
	});
});
