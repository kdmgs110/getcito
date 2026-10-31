import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const sdk = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));
vi.mock("olostep", () => ({
	default: class {
		batches = { create: sdk.create };
		retrieve = sdk.retrieve;
	},
}));

import { olostep } from "./olostep";

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.clearAllTimers();
	vi.useRealTimers();
});
function mockScrape() {
	vi.useFakeTimers();
	sdk.create.mockResolvedValue({
		waitTillDone: vi.fn().mockResolvedValue(undefined),
		async *items() {
			yield { retrieve_id: "locale" };
		},
	});
	sdk.retrieve.mockResolvedValue({ json_content: JSON.stringify({ answer: "日本語", search_queries: ["Rails案件"] }) });
}
describe("Olostep locale", () => {
	it.each(["Japanese", "English"])("passes explicit %s to chat without tying it to country", async (language) => {
		mockScrape();
		await olostep.run("chatgpt", "Rails案件", { targetLanguage: language, targetMarket: "Japan" });
		const [items, options] = sdk.create.mock.calls[0];
		expect(new URL(items[0].url).searchParams.get("q")).toBe(`Rails案件\nPlease provide your response in ${language}.`);
		expect(options.country).toBe("jp");
	});
	it("uses hl for a Google query without adding chat instructions", async () => {
		mockScrape();
		await olostep.run("google-ai-mode", "Rails案件", { targetLanguage: "ja-JP", targetMarket: "JP" });
		const url = new URL(sdk.create.mock.calls[0][0][0].url);
		expect(url.searchParams.get("hl")).toBe("ja");
		expect(url.searchParams.get("q")).toBe("Rails案件");
	});
	it("forwards research locale through both schema extraction attempts", async () => {
		const run = vi
			.spyOn(olostep, "run")
			.mockResolvedValueOnce({ textContent: "invalid", rawOutput: {}, citations: [], webQueries: [] })
			.mockResolvedValueOnce({ textContent: '{"name":"日本語"}', rawOutput: {}, citations: [], webQueries: [] });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await olostep.runStructuredResearch!({
			prompt: "Rails案件",
			schema: z.object({ name: z.string() }),
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
		expect(result.object).toEqual({ name: "日本語" });
		expect(run).toHaveBeenCalledTimes(2);
		for (const call of run.mock.calls)
			expect(call[2]).toEqual({ targetLanguage: "Japanese", targetMarket: "Japan", webSearch: true });
	});
});
