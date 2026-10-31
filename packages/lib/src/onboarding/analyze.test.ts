import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock the LLM and excerpt modules so the test exercises only normalization.
vi.mock("./llm", () => ({
	runStructuredResearchPrompt: vi.fn(),
	runStructuredCompletionPrompt: vi.fn(),
}));
vi.mock("../website-excerpt", () => ({
	getWebsiteExcerpt: vi.fn(async () => ""),
}));

import { analyzeBrand, analyzeBrandInfo, analyzeCompetitors, analyzePrompts, translatePrompts } from "./analyze";
import { runStructuredCompletionPrompt, runStructuredResearchPrompt } from "./llm";

afterEach(() => {
	vi.clearAllMocks();
});

describe("analyzeBrand", () => {
	it("normalizes brand fields, dedupes domains, and filters self-referential competitors", async () => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: ["acme.co.uk", "ACME.COM", "acme.de"],
			// Aliases containing "Acme" are redundant under substring mention
			// matching; only "Globex Holdings" (a distinct parent) survives.
			aliases: ["Acme Inc", "acme inc", "Acme", "Globex Holdings"],
			competitors: [
				// Competitor alias "Globex Worldwide" contains the comp name → drop;
				// "GBX" stays because it doesn't contain "Globex".
				{ name: "Globex", domains: ["globex.com", "globex.de"], aliases: ["GBX", "Globex Worldwide"] },
				{ name: "Self Reference", domains: ["acme.com"], aliases: [] },
				{ name: "Bad Domain", domains: ["not a domain"], aliases: [] },
				{ name: "Globex Dup", domains: ["globex.com"], aliases: [] },
			],
			suggestedPrompts: [
				// Tags are now free-form / brand-tailored. Normalize step lowercases
				// + kebab-cases + dedupes + caps at 3 per prompt.
				{ prompt: "Best Widgets", tags: ["Industrial Supplies", "Manufacturing"] },
				{ prompt: "best widgets", tags: ["industrial-supplies"] }, // duplicate after lowercasing
				{ prompt: "acme alternative", tags: ["alternatives", "industrial supplies", "buying guide", "extra-tag"] },
			],
		});

		const result = await analyzeBrand({
			website: "https://www.acme.com",
			brandName: "Acme",
			maxCompetitors: 5,
			maxPrompts: 10,
		});

		expect(result.brandName).toBe("Acme");
		expect(result.website).toBe("acme.com");
		expect(result.additionalDomains).toEqual(["acme.co.uk", "acme.de"]);
		expect(result.aliases).toEqual(["Globex Holdings"]);

		expect(result.competitors).toHaveLength(1);
		expect(result.competitors[0]).toMatchObject({
			name: "Globex",
			domains: ["globex.com", "globex.de"],
			aliases: ["GBX"],
		});

		expect(result.suggestedPrompts).toEqual([
			{ prompt: "best widgets", tags: ["industrial-supplies", "manufacturing"] },
			{
				prompt: "acme alternative",
				// "industrial supplies" → "industrial-supplies", capped at 3 (extra-tag dropped)
				tags: ["alternatives", "industrial-supplies", "buying-guide"],
			},
		]);
	});

	it("falls back to inferred brand name when LLM omits it", async () => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			brandName: "",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		});

		const result = await analyzeBrand({ website: "nike.com" });
		expect(result.brandName).toBe("Nike");
	});

	it("respects maxCompetitors=0 / maxPrompts=0", async () => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: [{ name: "Globex", domains: ["globex.com"], aliases: [] }],
			suggestedPrompts: [{ prompt: "best widgets", tags: ["best-of"] }],
		});

		const result = await analyzeBrand({
			website: "acme.com",
			maxCompetitors: 0,
			maxPrompts: 0,
		});
		expect(result.competitors).toEqual([]);
		expect(result.suggestedPrompts).toEqual([]);
	});

	it("caps competitors and prompts at the requested maxes", async () => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: Array.from({ length: 20 }, (_, i) => ({
				name: `Comp ${i}`,
				domains: [`comp${i}.com`],
				aliases: [],
			})),
			suggestedPrompts: Array.from({ length: 50 }, (_, i) => ({
				prompt: `prompt ${i}`,
				tags: ["best-of"],
			})),
		});

		const result = await analyzeBrand({
			website: "acme.com",
			maxCompetitors: 3,
			maxPrompts: 5,
		});
		expect(result.competitors).toHaveLength(3);
		expect(result.suggestedPrompts).toHaveLength(5);
	});
});

describe("localized generation", () => {
	it.each([
		["combined brand analysis", analyzeBrand],
		["brand information", analyzeBrandInfo],
		["competitor regeneration", analyzeCompetitors],
	] as const)("forwards the selected locale through %s", async (_name, generate) => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			brandName: "Rails",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [{ prompt: "Railsの案件を探すには？", tags: ["案件"] }],
		});
		const result = await generate({
			website: "rails.example.com",
			brandName: "Rails",
			targetLanguage: "ja",
			targetMarket: "JP",
		});
		expect(vi.mocked(runStructuredResearchPrompt).mock.calls[0][2]).toMatchObject({
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
		if ("suggestedPrompts" in result && Array.isArray(result.suggestedPrompts)) expect(result.suggestedPrompts[0].prompt).toBe("Railsの案件を探すには？");
	});

	it("generates Japanese questions and preserves technical names and Japanese tags", async () => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			suggestedPrompts: [{ prompt: "Railsのフリーランス案件を探せるサイトは？", tags: ["案件選び"] }],
		});
		const result = await analyzePrompts({
			website: "rails.example.com",
			brandName: "Rails案件.com",
			targetLanguage: "ja-JP",
			targetMarket: "JP",
		});
		expect(result.suggestedPrompts).toEqual([
			{ prompt: "Railsのフリーランス案件を探せるサイトは？", tags: ["案件選び"] },
		]);
		const [instructions, schema, locale] = vi.mocked(runStructuredResearchPrompt).mock.calls[0];
		expect(instructions).toContain("候補の質問文・説明文は日本語で作成");
		expect(locale).toMatchObject({ targetLanguage: "Japanese", targetMarket: "Japan" });
		const promptDescription = JSON.stringify(z.toJSONSchema(schema));
		expect(promptDescription).toContain("日本語で自然な");
		expect(promptDescription).not.toContain("under ~12 words");
	});

	it("keeps default English normalization while forwarding the selected language", async () => {
		vi.mocked(runStructuredResearchPrompt).mockResolvedValueOnce({
			suggestedPrompts: [{ prompt: "Best Rails Jobs", tags: [] }],
		});
		const result = await analyzePrompts({ website: "rails.example.com", brandName: "Rails", targetLanguage: "en" });
		expect(result.suggestedPrompts[0].prompt).toBe("best rails jobs");
		expect(vi.mocked(runStructuredResearchPrompt).mock.calls[0][2]).toMatchObject({ targetLanguage: "English" });
	});

	it("previews translations without researching or modifying the source prompts", async () => {
		const source = [{ prompt: "Best Rails Jobs", tags: ["jobs"] }];
		vi.mocked(runStructuredCompletionPrompt).mockResolvedValueOnce({
			object: { suggestedPrompts: [{ prompt: "Rails案件を探せるおすすめサイトは？", tags: ["案件"] }] },
			modelVersion: "test",
		});
		const result = await translatePrompts({ targetLanguage: "Japanese", targetMarket: "Japan", prompts: source });
		expect(result.suggestedPrompts[0].prompt).toContain("Rails案件");
		expect(source[0].prompt).toBe("Best Rails Jobs");
		expect(runStructuredResearchPrompt).not.toHaveBeenCalled();
		expect(vi.mocked(runStructuredCompletionPrompt).mock.calls[0][2]).toMatchObject({
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
	});

	it("requires an explicit translation language and limits the paid request size", async () => {
		await expect(translatePrompts({ prompts: [{ prompt: "Jobs", tags: [] }] })).rejects.toThrow(
			"BRAND_LANGUAGE_REQUIRED",
		);
		await expect(
			translatePrompts({
				targetLanguage: "ja",
				prompts: Array.from({ length: 31 }, () => ({ prompt: "Jobs", tags: [] })),
			}),
		).rejects.toThrow("PROMPT_TRANSLATION_LIMIT");
		expect(runStructuredCompletionPrompt).not.toHaveBeenCalled();
	});
});
