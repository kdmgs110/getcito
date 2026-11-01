import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataforseoScraper, normalizeDataForSeoScraperResponse } from "./dataforseo-scraper";

function payload(result: Record<string, unknown> = {}) {
	return {
		status_code: 20000,
		tasks: [{ status_code: 20000, result: [{ markdown: "日本語の回答", model: "actual-web-model", ...result }] }],
	};
}
beforeEach(() => {
	vi.stubEnv("DATAFORSEO_LOGIN", "test-account");
	vi.stubEnv("DATAFORSEO_PASSWORD", "private-test-value");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
describe("DataForSEO ChatGPT Web scraper", () => {
	it("uses native Japanese/Japan locale and preserves actual queries in execution order", async () => {
		const raw = payload({ fan_out_queries: ["Rails フルリモート 案件", "Rails 単価 相場", "Rails フルリモート 案件"] });
		const fetchMock = vi.fn().mockResolvedValue(Response.json(raw));
		vi.stubGlobal("fetch", fetchMock);
		const prompt = "Rails案件を探して";
		const result = await dataforseoScraper.run("chatgpt", prompt, {
			targetLanguage: "Japanese",
			targetMarket: "JP",
			webSearch: true,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced");
		expect(JSON.parse(request.body)).toEqual([
			{ keyword: prompt, location_name: "Japan", language_code: "ja", force_web_search: true },
		]);
		expect(request.signal).toBeInstanceOf(AbortSignal);
		expect(result).toMatchObject({
			rawOutput: raw,
			textContent: "日本語の回答",
			modelVersion: "actual-web-model",
			webQueries: ["Rails フルリモート 案件", "Rails 単価 相場", "Rails フルリモート 案件"],
			measurement: { submittedPrompt: prompt, answerStatus: "shown", queryStatus: "observed", queryEvidence: [] },
		});
	});
	it("escapes endpoint percent/plus decoding without changing the actual prompt", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		const prompt = "C++ 50% %20 100%25";
		const result = await dataforseoScraper.run("chatgpt", prompt);
		const keyword = JSON.parse(fetchMock.mock.calls[0][1].body)[0].keyword;
		expect(keyword).toBe("C%2B%2B 50%25 %2520 100%2525");
		expect(decodeURIComponent(keyword.replaceAll("+", " "))).toBe(prompt);
		expect(result.measurement?.submittedPrompt).toBe(prompt);
	});
	it("separates explicit answer sources from search results and query edges", () => {
		const result = normalizeDataForSeoScraperResponse(
			payload({
				fan_out_queries: ["real query", " ", 42, { query: "not a declared string" }],
				sources: [
					{ url: "https://www.example.com/path?full=1", title: "Source" },
					{ url: "javascript:alert(1)" },
					{ url: "https://user:secret@example.com/" },
					{ url: "https://www.example.com/path?full=1" },
				],
				search_results: [{ url: "https://search-result.example/" }],
			}),
			"original",
			true,
		);
		expect(result.webQueries).toEqual(["real query"]);
		expect(result.citations).toEqual([
			{ url: "https://www.example.com/path?full=1", title: "Source", domain: "example.com", citationIndex: 0 },
		]);
		expect(result.measurement?.queryEvidence).toEqual([]);
	});
	it("marks missing fan-out unavailable without inferring it from keyword or URLs", () => {
		const result = normalizeDataForSeoScraperResponse(
			payload({ keyword: "original", fan_out_queries: null, sources: [{ url: "https://example.com/?q=made-up" }] }),
			"original",
			true,
		);
		expect(result.webQueries).toEqual(["unavailable"]);
		expect(result.measurement?.queryStatus).toBe("not_exposed");
	});
	it("does not adopt returned searches with the web-search flag off", () => {
		const result = normalizeDataForSeoScraperResponse(
			payload({ fan_out_queries: ["unexpected query"] }),
			"original",
			false,
		);
		expect(result.webQueries).toEqual([]);
		expect(result.measurement?.queryStatus).toBe("not_used");
	});
	it.each([
		{ status_code: 20000, tasks: [{ status_code: 40501, status_message: "private-test-value", result: [] }] },
		{ status_code: 40501, tasks: [{ status_code: 20000, result: [{ markdown: "answer" }] }] },
		{ status_code: 20000, tasks: [] },
		payload({ markdown: " " }),
		payload({ markdown: undefined, answer_text: "wrong contract" }),
	])("rejects malformed/unsuccessful responses without exposing upstream data", async (raw) => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(raw));
		vi.stubGlobal("fetch", fetchMock);
		await expect(dataforseoScraper.run("chatgpt", "original", { webSearch: true })).rejects.toThrow(
			/^DataForSEO LLM Scraper (task did not succeed|returned no answer text)$/,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it.each([
		new Error("https://test-account:private-test-value@example.com/"),
		new DOMException("private-test-value", "TimeoutError"),
	])("sanitizes network errors without automatic retries", async (error) => {
		const fetchMock = vi.fn().mockRejectedValue(error);
		vi.stubGlobal("fetch", fetchMock);
		await expect(dataforseoScraper.run("chatgpt", "original")).rejects.toThrow(
			"DataForSEO LLM Scraper acquisition failed",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("does not expose rejected HTTP response bodies", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("private-test-value", { status: 403 }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(dataforseoScraper.run("chatgpt", "original")).rejects.toThrow(
			"DataForSEO LLM Scraper request failed (403)",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it.each([
		"",
		" ",
		"x".repeat(2001),
		"+".repeat(1000),
	])("rejects empty/overlong encoded input before requesting", async (prompt) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(dataforseoScraper.run("chatgpt", prompt)).rejects.toThrow(/^DataForSEO LLM Scraper/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("accepts a 2000-codepoint Japanese question", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		await dataforseoScraper.run("chatgpt", "問".repeat(2000));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("rejects unsupported models, versions and locales before requesting", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(dataforseoScraper.run("gemini", "original")).rejects.toThrow("only supports ChatGPT Web");
		await expect(dataforseoScraper.run("chatgpt", "original", { version: "custom" })).rejects.toThrow(
			"does not support selecting a model version",
		);
		await expect(dataforseoScraper.run("chatgpt", "original", { targetLanguage: "Klingon" })).rejects.toThrow(
			"BRAND_LANGUAGE_INVALID",
		);
		await expect(dataforseoScraper.run("chatgpt", "original", { targetMarket: "Mars" })).rejects.toThrow(
			"BRAND_MARKET_INVALID",
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(
			dataforseoScraper.validateTarget?.({ model: "chatgpt", provider: "dataforseo-scraper", webSearch: true }),
		).toBeNull();
	});
	it("requires both existing DataForSEO credentials", async () => {
		vi.stubEnv("DATAFORSEO_PASSWORD", "");
		expect(dataforseoScraper.isConfigured()).toBe(false);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(dataforseoScraper.run("chatgpt", "original")).rejects.toThrow("credentials are not configured");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
