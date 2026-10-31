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
	sdk.snapshot.mockResolvedValue([{ answer_text: "回答" }]);
	return fetchMock;
}
describe("BrightData locale", () => {
	it.each(["Japanese", "English"])("uses explicit %s for chat and a native country", async (language) => {
		const fetchMock = mockScrape();
		await brightdata.run("chatgpt", "Rails案件", { targetLanguage: language, targetMarket: "JP" });
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({
			prompt: `Rails案件\nPlease provide your response in ${language}.`,
			country: "jp",
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
});
