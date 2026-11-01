import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ snapshot: vi.fn(), close: vi.fn() }));
vi.mock("@brightdata/sdk", () => ({
	bdclient: class {
		scrape = { snapshot: { fetch: sdk.snapshot } };
		close = sdk.close;
	},
}));

import { brightdata } from "./brightdata";

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
function mockScrape() {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ snapshot_id: "locale-test" }))
		.mockResolvedValueOnce(Response.json({ status: "ready" }));
	vi.stubGlobal("fetch", fetchMock);
	sdk.snapshot.mockResolvedValue([{ answer_text: "回答", aio_text: "回答" }]);
	return fetchMock;
}
describe("BrightData locale", () => {
	it.each(["Japanese", "English"])("uses explicit %s for chat and a native country", async (language) => {
		const fetchMock = mockScrape();
		await brightdata.run("chatgpt", "Rails案件", { targetLanguage: language, targetMarket: "JP" });
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({
			prompt: `Rails案件\nPlease provide your response in ${language}.`,
			country: "JP",
		});
	});
	it.each([
		["google-ai-mode", "hl"],
		["google-ai-overview", "language"],
	])("keeps %s query unmodified and uses its native language field", async (model, languageField) => {
		const fetchMock = mockScrape();
		await brightdata.run(model, "Rails案件", { targetLanguage: "ja-JP", targetMarket: "Japan" });
		const request = JSON.parse(fetchMock.mock.calls[0][1].body)[0];
		expect(request[languageField]).toBe("ja");
		expect(request.keyword ?? request.prompt).toBe("Rails案件");
		expect(request.country).toBe("jp");
	});
	it("does not append an English instruction when language is unset", async () => {
		const fetchMock = mockScrape();
		await brightdata.run("chatgpt", "Rails案件");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0].prompt).toBe("Rails案件");
	});
	it("rejects unknown explicit languages without submitting a request", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(brightdata.run("chatgpt", "Rails案件", { targetLanguage: "Klingon" })).rejects.toThrow(
			"BRAND_LANGUAGE_INVALID",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("does not silently drop a market rejected by the engine", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(new Response('Invalid "country"', { status: 400 }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(brightdata.run("chatgpt", "Rails案件", { targetMarket: "Japan" })).rejects.toThrow(
			"does not support the selected market",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("requests only the first AIO result page and returns normalized Overview evidence", async () => {
		const fetchMock = mockScrape();
		sdk.snapshot.mockResolvedValue([
			{ aio_markdown: "日本語の概要", aio_citations: [{ url: "https://example.com/" }] },
		]);
		const result = await brightdata.run("google-ai-overview", "元の質問", {
			webSearch: true,
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({
			keyword: "元の質問",
			language: "ja",
			country: "jp",
			start_page: 1,
			end_page: 1,
			collapse_aio: false,
		});
		expect(result.textContent).toBe("日本語の概要");
		expect(result.measurement).toMatchObject({ answerStatus: "shown", queryStatus: "not_exposed" });
		expect(result.citations[0].url).toBe("https://example.com/");
	});
	it("retains structured raw search evidence while dropping only HTML representations", async () => {
		mockScrape();
		const raw = JSON.stringify({ metadata: { search_model_queries: ["actual search"] } });
		sdk.snapshot.mockResolvedValue([
			{ answer_text: "本文", response_raw: raw, answer_html: "<p>本文</p>", answer_section_html: "<main>本文</main>" },
		]);
		const result = await brightdata.run("chatgpt", "元の質問", { webSearch: true });
		expect(result.rawOutput).toEqual([{ answer_text: "本文", response_raw: raw }]);
		expect(result.webQueries).toEqual(["actual search"]);
		expect(result.measurement?.submittedPrompt).toBe("元の質問");
	});
	it("returns Overview absence separately from failed acquisition", async () => {
		mockScrape();
		sdk.snapshot.mockResolvedValue([{ aio_text: null, aio_citations: [], organic: [] }]);
		const result = await brightdata.run("google-ai-overview", "質問", { webSearch: true });
		expect(result.measurement?.answerStatus).toBe("not_shown");
		expect(result.textContent).toBe("");
	});
	it("does not expose a rejected trigger's raw response body", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("API_TOKEN=private-value", { status: 403 })));
		await expect(brightdata.run("chatgpt", "質問", { webSearch: true })).rejects.toThrow(
			"BrightData trigger failed (403)",
		);
	});
	it("does not pass through SDK error bodies even when their message starts with the provider name", async () => {
		mockScrape();
		sdk.snapshot.mockRejectedValueOnce(new Error("BrightData upstream request API_TOKEN=private-value"));
		await expect(brightdata.run("chatgpt", "質問", { webSearch: true })).rejects.toThrow(
			"BrightData acquisition failed",
		);
	});
	it("keeps a successful acquisition when best-effort client cleanup fails", async () => {
		mockScrape();
		sdk.close.mockRejectedValueOnce(new Error("private cleanup details"));
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(brightdata.run("chatgpt", "質問", { webSearch: true })).resolves.toMatchObject({
				textContent: "回答",
			});
			expect(warning).toHaveBeenCalledWith("BrightData client cleanup failed");
		} finally {
			warning.mockRestore();
		}
	});
});
