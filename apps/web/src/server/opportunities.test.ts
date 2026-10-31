import { brandOpportunities, brands } from "@workspace/lib/db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { opportunityGenerationContext } from "@/lib/opportunity-language";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	completion: vi.fn(),
	insert: vi.fn(),
	digestPrompts: vi.fn(),
	stats: vi.fn(),
	appLanguage: "ja" as "ja" | "en",
	brand: {
		id: "brand",
		name: "検証ブランド",
		website: "https://example.com",
		additionalDomains: [],
		targetLanguage: "Japanese" as string | null,
		targetMarket: "Japan" as string | null,
	},
	latest: undefined as { report: unknown; createdAt: Date } | undefined,
	select: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (input: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/i18n", () => ({
	t: (key: string) => key,
	get APP_LANGUAGE() {
		return mocks.appLanguage;
	},
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: async () => mocks.brand } },
		select: mocks.select,
		insert: () => ({ values: mocks.insert }),
	},
}));
vi.mock("@workspace/lib/onboarding", () => ({ runStructuredCompletionPrompt: mocks.completion }));
vi.mock("@/server/prompt-resolution", () => ({ resolveFilteredPrompts: mocks.digestPrompts }));
vi.mock("@/lib/domain-categories.server", () => ({ categorizeDomain: () => "other" }));
vi.mock("@/lib/postgres-read", () => ({
	getPerPromptRunStats: mocks.stats,
	getPerPromptDailyCompetitorMentions: async () => [],
	getPerPromptDailyCitationStats: async () => [],
	getPerPromptCitationPages: async () => [],
	getBrandMentionRateByModel: async () => [],
}));

import { getOpportunitiesFn } from "./opportunities";

const englishProse =
	"Independent editorial recommendations should describe specific opportunities for prospective customers comparing providers and reviewing the available alternatives across trusted websites and relevant community discussions.";
const japaneseReport = {
	summary: ["比較検討中の読者が参照する第三者サイトで紹介を増やしましょう。"],
	opportunities: [
		{
			category: "creation",
			title: "比較記事の作成",
			why: "競合を比較する読者に根拠を示して選択肢を紹介しましょう。",
			relatedPrompts: ["おすすめのサービスは？"],
		},
	],
	risks: ["根拠のない評価や不自然な口コミを避けましょう。"],
};
const englishReport = {
	summary: [englishProse],
	opportunities: [{ category: "creation", title: "Create a comparison", why: englishProse, relatedPrompts: [] }],
	risks: [englishProse],
};
const request = { data: { brandId: "brand", timezone: "Asia/Tokyo" } };
const context = () => opportunityGenerationContext(mocks.brand, mocks.appLanguage, "Asia/Tokyo");
const cached = (days: number, report = { ...japaneseReport, generationContext: context() }) => {
	mocks.latest = { createdAt: new Date(Date.now() - days * 86_400_000), report };
	return report;
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.auth.mockResolvedValue({ user: { id: "member" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.appLanguage = "ja";
	mocks.brand.targetLanguage = "Japanese";
	mocks.brand.targetMarket = "Japan";
	mocks.latest = undefined;
	mocks.digestPrompts.mockResolvedValue([{ id: "prompt", value: "おすすめのサービスは？", tags: [], systemTags: [] }]);
	mocks.stats.mockResolvedValue([{ prompt_id: "prompt", runs: 5, brand_mention_rate: 0.2 }]);
	mocks.completion.mockResolvedValue({ object: japaneseReport, modelVersion: "test-model" });
	mocks.insert.mockResolvedValue(undefined);
	mocks.select.mockImplementation(() => ({
		from: (table: unknown) => ({
			where: () => {
				const rows =
					table === brandOpportunities ? (mocks.latest ? [mocks.latest] : []) : table === brands ? [mocks.brand] : [];
				return Object.assign(Promise.resolve(rows), {
					limit: async () => rows,
					orderBy: () => ({ limit: async () => rows }),
				});
			},
		}),
	}));
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("opportunity language generation and caching", () => {
	it("passes brand language and market to the API, instructs all prose and saves locale metadata", async () => {
		const result = await getOpportunitiesFn(request);
		expect(mocks.completion).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("OUTPUT LANGUAGE: Japanese (ja)"),
			expect.anything(),
			{ targetLanguage: "Japanese", targetMarket: "Japan" },
		);
		expect(result.report?.generationContext).toEqual(context());
		expect(result.report?.opportunities[0].relatedPrompts).toEqual([
			{ text: "おすすめのサービスは？", promptId: "prompt" },
		]);
		expect(mocks.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				brandId: "brand",
				model: "test-model",
				report: expect.objectContaining({ generationContext: context() }),
			}),
		);
	});
	it("honors English brand settings despite a Japanese application locale", async () => {
		mocks.brand.targetLanguage = "en";
		mocks.brand.targetMarket = null;
		mocks.completion.mockResolvedValue({ object: englishReport });
		const result = await getOpportunitiesFn(request);
		expect(mocks.completion).toHaveBeenCalledWith(
			expect.stringContaining("OUTPUT LANGUAGE: English (en)"),
			expect.anything(),
			{ targetLanguage: "English", targetMarket: undefined },
		);
		expect(result.report?.generationContext?.languageCode).toBe("en");
	});
	it.each([
		"ja",
		"en",
	] as const)("falls back to application language %s when brand language is unspecified", async (language) => {
		mocks.brand.targetLanguage = null;
		mocks.appLanguage = language;
		mocks.completion.mockResolvedValue({ object: language === "ja" ? japaneseReport : englishReport });
		expect((await getOpportunitiesFn(request)).report?.generationContext?.languageCode).toBe(language);
	});
	it("reuses compatible fresh cache without gathering data or calling an API", async () => {
		const report = cached(1);
		expect((await getOpportunitiesFn(request)).report).toEqual(report);
		expect(mocks.digestPrompts).not.toHaveBeenCalled();
		expect(mocks.completion).not.toHaveBeenCalled();
	});
	it("regenerates legacy English cache without a locale snapshot", async () => {
		mocks.latest = { createdAt: new Date(), report: englishReport };
		expect((await getOpportunitiesFn(request)).report?.summary).toEqual(japaneseReport.summary);
		expect(mocks.completion).toHaveBeenCalledTimes(1);
	});
	it.each(["market", "timezone"])("invalidates cache when %s changes", async (changed) => {
		cached(1);
		if (changed === "market") mocks.brand.targetMarket = "United States";
		const input = changed === "timezone" ? { data: { ...request.data, timezone: "UTC" } } : request;
		await getOpportunitiesFn(input);
		expect(mocks.completion).toHaveBeenCalledTimes(1);
	});
	it("falls back to stale compatible cache after all generation attempts fail", async () => {
		const report = cached(8);
		mocks.completion.mockRejectedValue(new Error("provider unavailable"));
		expect((await getOpportunitiesFn(request)).report).toEqual(report);
		expect(mocks.completion).toHaveBeenCalledTimes(3);
		expect(mocks.insert).not.toHaveBeenCalled();
	});
	it("does not fall back to incompatible English reports after generation fails", async () => {
		mocks.latest = {
			createdAt: new Date(),
			report: {
				...englishReport,
				generationContext: opportunityGenerationContext({ targetLanguage: "English" }, "en", "Asia/Tokyo"),
			},
		};
		mocks.completion.mockRejectedValue(new Error("provider unavailable"));
		await expect(getOpportunitiesFn(request)).rejects.toThrow("Failed to generate");
		expect(mocks.completion).toHaveBeenCalledTimes(3);
		expect(mocks.insert).not.toHaveBeenCalled();
	});
	it("retries and rejects all-English output even when schema-valid for a Japanese brand", async () => {
		mocks.completion.mockResolvedValue({ object: englishReport });
		await expect(getOpportunitiesFn(request)).rejects.toThrow("Failed to generate");
		expect(mocks.completion).toHaveBeenCalledTimes(3);
		expect(mocks.insert).not.toHaveBeenCalled();
	});
	it("regenerates all-English cache even if its metadata claims Japanese", async () => {
		mocks.latest = { createdAt: new Date(), report: { ...englishReport, generationContext: context() } };
		expect((await getOpportunitiesFn(request)).report?.summary).toEqual(japaneseReport.summary);
		expect(mocks.completion).toHaveBeenCalledTimes(1);
	});
	it("returns insufficient data instead of incompatible cache when no tracked prompts exist", async () => {
		mocks.latest = { createdAt: new Date(), report: englishReport };
		mocks.digestPrompts.mockResolvedValue([]);
		await expect(getOpportunitiesFn(request)).resolves.toEqual({
			report: null,
			reason: "insufficient-data",
			generatedFor: null,
		});
		expect(mocks.completion).not.toHaveBeenCalled();
	});
	it.each([
		"authentication",
		"membership",
	])("rejects %s failure before reading or generating reports", async (failure) => {
		if (failure === "authentication") mocks.auth.mockRejectedValue(new Error("Unauthorized"));
		else mocks.access.mockRejectedValue(new Error("Forbidden"));
		await expect(getOpportunitiesFn(request)).rejects.toThrow(
			failure === "authentication" ? "Unauthorized" : "Forbidden",
		);
		expect(mocks.select).not.toHaveBeenCalled();
		expect(mocks.completion).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
	});
});
