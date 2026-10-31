import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ research: vi.fn() }));
vi.mock("../providers", () => ({
	getProvider: () => ({ id: "openai-api", isConfigured: () => true, runStructuredResearch: mocks.research }),
	parseScrapeTargets: () => [],
	withProviderCallTracking: (_context: unknown, fn: () => unknown) => fn(),
}));

import { runStructuredCompletionPrompt, runStructuredResearchPrompt } from "./llm";

beforeEach(() => {
	mocks.research.mockReset().mockResolvedValue({ object: { text: "日本語" }, modelVersion: "test" });
});
describe("onboarding provider locale forwarding", () => {
	it("sends both language and market to structured research", async () => {
		const schema = z.object({ text: z.string() });
		await expect(
			runStructuredResearchPrompt("prompt", schema, { targetLanguage: "Japanese", targetMarket: "Japan" }),
		).resolves.toEqual({ text: "日本語" });
		expect(mocks.research).toHaveBeenCalledWith({
			prompt: "prompt",
			schema,
			version: undefined,
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
	});
	it("sends translation locale with search disabled", async () => {
		await runStructuredCompletionPrompt("translate", z.object({ text: z.string() }), { targetLanguage: "Japanese" });
		expect(mocks.research).toHaveBeenCalledWith(
			expect.objectContaining({ targetLanguage: "Japanese", webSearch: false }),
		);
	});
});
