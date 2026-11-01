import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	prompt: vi.fn(),
	brand: vi.fn(),
	attempt: vi.fn(),
	attempts: vi.fn(),
	run: vi.fn(),
	runs: vi.fn(),
	select: vi.fn(),
	distinct: vi.fn(),
	targets: vi.fn(),
	queryWhere: undefined as unknown,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (value: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@workspace/lib/providers", () => ({ selectTargetsForBrand: mocks.targets }));
vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: {
			prompts: { findFirst: mocks.prompt },
			brands: { findFirst: mocks.brand },
			measurementAttempts: { findFirst: mocks.attempt, findMany: mocks.attempts },
			promptRuns: { findFirst: mocks.run, findMany: mocks.runs },
		},
		select: mocks.select,
		selectDistinct: mocks.distinct,
	},
}));

import { getPromptMeasurementDetailFn, getPromptMeasurementsFn } from "./prompt-measurements";

const promptId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const targetKey = "chatgpt:brightdata:online";
const context = {
	version: 1 as const,
	prompt: "Rails 案件を比較して",
	targetLanguage: "Japanese",
	targetMarket: "Japan",
	languageCode: "ja",
	countryCode: "JP",
};
const scope = {
	brandId: "our-brand",
	promptId,
	lookback: "custom:2026-10-01:2026-10-31",
	language: "ja",
	timezone: "Asia/Tokyo",
};
const run = () => ({
	id: runId,
	brandId: "our-brand",
	promptId,
	model: "chatgpt",
	provider: "brightdata",
	version: "web-returned-version",
	webSearchEnabled: true,
	createdAt: new Date("2026-10-25T00:00:00Z"),
	requestContext: context,
	webQueries: ["Rails 案件"],
	rawOutput: { answer_text: "日本語の回答" },
});
const attempt = () => ({
	id: attemptId,
	batchId: "batch",
	brandId: "our-brand",
	promptId,
	targetKey,
	model: "chatgpt",
	provider: "brightdata",
	requestedVersion: null,
	webSearchEnabled: true,
	status: "succeeded",
	promptRunId: runId,
	iteration: 1,
	createdAt: new Date("2026-10-25T00:00:00Z"),
	startedAt: new Date("2026-10-25T00:00:00Z"),
	completedAt: new Date("2026-10-25T00:01:00Z"),
	requestContext: context,
	evidence: {
		version: 1,
		answerText: "日本語の回答",
		answerStatus: "shown",
		queryStatus: "observed",
		queryEvidence: [],
	},
	errorCode: null,
});
const sql = (where: unknown) => new PgDialect().sqlToQuery(where as SQL);

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("SCRAPE_TARGETS", "chatgpt:brightdata:online,google-ai-overview:brightdata:online");
	mocks.auth.mockResolvedValue({ user: { id: "member" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.prompt.mockResolvedValue({ id: promptId, brandId: scope.brandId });
	mocks.brand.mockResolvedValue({ id: scope.brandId, enabledModels: null, enabledTargets: null });
	mocks.targets.mockImplementation((configs) => configs);
	mocks.attempt.mockResolvedValue(undefined);
	mocks.run.mockResolvedValue(undefined);
	mocks.attempts.mockResolvedValue([]);
	mocks.runs.mockResolvedValue([]);
	mocks.distinct.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
	mocks.select.mockReturnValue({
		from: () => ({
			where: (where: unknown) => {
				mocks.queryWhere = where;
				return Promise.resolve([]);
			},
		}),
	});
});

describe("authenticated measurement read API", () => {
	it("rejects unauthenticated and non-member users before reading any prompt or run", async () => {
		mocks.auth.mockRejectedValueOnce(new Error("Unauthenticated"));
		await expect(getPromptMeasurementsFn({ data: scope })).rejects.toThrow("Unauthenticated");
		expect(mocks.prompt).not.toHaveBeenCalled();
		mocks.access.mockRejectedValueOnce(new Error("Forbidden"));
		await expect(getPromptMeasurementDetailFn({ data: { ...scope, runId } })).rejects.toThrow("Forbidden");
		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("requires a prompt belonging to the authorized brand", async () => {
		mocks.prompt.mockResolvedValueOnce(undefined);
		await expect(getPromptMeasurementsFn({ data: scope })).rejects.toThrow("Prompt not found");
		expect(mocks.access).toHaveBeenCalledWith("member", scope.brandId);
		const query = sql(mocks.prompt.mock.calls[0][0].where);
		expect(query.params).toEqual([scope.brandId, promptId]);
		expect(mocks.attempts).not.toHaveBeenCalled();
	});
	it("scopes exact attempts by brand, prompt, target, date and captured request language", async () => {
		await expect(getPromptMeasurementDetailFn({ data: { ...scope, attemptId, targetKey } })).rejects.toThrow(
			"Measurement not found",
		);
		const query = sql(mocks.attempt.mock.calls[0][0].where);
		expect(query.params).toEqual(
			expect.arrayContaining([
				scope.brandId,
				promptId,
				attemptId,
				targetKey,
				"ja",
				"Asia/Tokyo",
				"2026-10-01",
				"2026-10-31",
			]),
		);
		expect(query.sql).toContain('"brand_id"');
		expect(query.sql).toContain('"prompt_id"');
		expect(query.sql).toContain("languageCode");
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("rejects mismatched run or target identifiers rather than returning an adjacent answer", async () => {
		mocks.attempt.mockResolvedValue(attempt());
		mocks.run.mockResolvedValue(run());
		await expect(
			getPromptMeasurementDetailFn({ data: { ...scope, attemptId, targetKey: "other-target" } }),
		).rejects.toThrow("target mismatch");
		await expect(
			getPromptMeasurementDetailFn({ data: { ...scope, attemptId, runId: "00000000-0000-4000-8000-000000000004" } }),
		).rejects.toThrow("run mismatch");
	});
	it("never labels DataForSEO ChatGPT API or Google AI Mode runs as Web evidence", async () => {
		mocks.run.mockResolvedValueOnce({ ...run(), provider: "dataforseo" });
		await expect(getPromptMeasurementDetailFn({ data: { ...scope, runId } })).rejects.toThrow(
			"Unsupported measurement surface",
		);
		mocks.run.mockResolvedValueOnce({ ...run(), model: "google-ai-mode" });
		await expect(getPromptMeasurementDetailFn({ data: { ...scope, runId } })).rejects.toThrow(
			"Unsupported measurement surface",
		);
	});
	it("includes DataForSEO Web scraper attempts without borrowing BrightData or API answers and queries", async () => {
		const scraperTarget = "chatgpt:dataforseo-scraper:online";
		vi.stubEnv("SCRAPE_TARGETS", `chatgpt:brightdata:online,${scraperTarget},chatgpt:dataforseo:online`);
		const scraperRun = {
			...run(),
			provider: "dataforseo-scraper",
			webQueries: ["Rails 実際のファンアウト"],
		};
		mocks.runs.mockResolvedValueOnce([scraperRun]).mockResolvedValueOnce([]);
		mocks.attempts.mockImplementation(async ({ where }) => {
			const params = sql(where).params;
			if (!params.includes(scraperTarget) || !params.includes("dataforseo-scraper")) return [];
			return [
				{
					...attempt(),
					targetKey: scraperTarget,
					provider: "dataforseo-scraper",
					evidence: { ...attempt().evidence, answerText: "スクレイパー自身の回答" },
				},
			];
		});
		const result = await getPromptMeasurementsFn({ data: scope });
		expect(result.targets.map((target) => target.key)).toEqual([targetKey, scraperTarget]);
		expect(result.records).toHaveLength(1);
		expect(result.records[0]).toMatchObject({
			targetKey: scraperTarget,
			provider: "dataforseo-scraper",
			queries: ["Rails 実際のファンアウト"],
			evidence: { answerText: "スクレイパー自身の回答", queryEvidence: [] },
		});
		const legacyScope = sql(mocks.runs.mock.calls[1][0].where);
		expect(legacyScope.params).toContain("dataforseo-scraper");
		expect(legacyScope.params).not.toContain("dataforseo");
	});
	it("reads answer-wide citations only for the exact prompt/run and returns original locale plus on-demand raw output", async () => {
		mocks.attempt.mockResolvedValue(attempt());
		mocks.run.mockResolvedValue(run());
		mocks.select.mockReturnValue({
			from: () => ({
				where: (where: unknown) => {
					mocks.queryWhere = where;
					return Promise.resolve([
						{ promptRunId: runId, url: "https://example.com/ours", title: "Our source" },
						{ promptRunId: "different-run", url: "https://example.com/other", title: "Other source" },
					]);
				},
			}),
		});
		const result = await getPromptMeasurementDetailFn({ data: { ...scope, attemptId, runId, targetKey } });
		expect(sql(mocks.queryWhere).params).toEqual([scope.brandId, promptId, runId]);
		expect(result.citations).toEqual([{ url: "https://example.com/ours", title: "Our source" }]);
		expect(result.requestContext).toEqual(context);
		expect(JSON.parse(result.rawOutput ?? "null")).toEqual(run().rawOutput);
		expect(result.evidence.queryEvidence).toEqual([]);
	});
	it("shows a failed attempt without a successful run, and limits each target independently", async () => {
		mocks.attempts
			.mockResolvedValueOnce([{ ...attempt(), status: "failed", promptRunId: null, evidence: null }])
			.mockResolvedValueOnce([]);
		const result = await getPromptMeasurementsFn({ data: scope });
		expect(mocks.attempts).toHaveBeenCalledTimes(2);
		for (const [query] of mocks.attempts.mock.calls) expect(query.limit).toBe(20);
		expect(result.targets.map((target) => target.surface)).toEqual(["chatgpt_web", "google_ai_overview"]);
		expect(result.records[0]).toMatchObject({ status: "failed", runId: null, requestContext: context });
		expect(result.records[0].rawOutput).toBeUndefined();
	});
	it("does not load or inspect large provider payloads when listing normalized attempts", async () => {
		mocks.attempts.mockResolvedValueOnce([attempt()]).mockResolvedValueOnce([]);
		const linkedRun = {
			...run(),
			get rawOutput() {
				throw new Error("Raw provider output must stay on demand");
			},
		};
		mocks.runs.mockResolvedValueOnce([linkedRun]).mockResolvedValueOnce([]);
		const result = await getPromptMeasurementsFn({ data: scope });
		for (const [query] of mocks.attempts.mock.calls) expect(query.columns).toEqual({ rawOutput: false });
		expect(mocks.runs.mock.calls[0][0].columns).toEqual({ rawOutput: false });
		expect(result.records[0].evidence.answerText).toBe("日本語の回答");
		expect(result.records[0].version).toBe("web-returned-version");
		expect(result.records[0].queries).toEqual(["Rails 案件"]);
		expect(result.records[0]).not.toHaveProperty("rawOutput");
	});
	it("retains absent Overview raw evidence without creating or borrowing a successful run", async () => {
		const rawOutput = { ai_overview: null, organic: [{ url: "https://example.com/organic" }] };
		mocks.attempt.mockResolvedValue({
			...attempt(),
			model: "google-ai-overview",
			promptRunId: null,
			rawOutput,
			evidence: {
				version: 1,
				answerText: "",
				answerStatus: "not_shown",
				queryStatus: "not_exposed",
				queryEvidence: [],
			},
		});
		const result = await getPromptMeasurementDetailFn({ data: { ...scope, attemptId } });
		expect(result.runId).toBeNull();
		expect(result.evidence.answerStatus).toBe("not_shown");
		expect(JSON.parse(result.rawOutput ?? "null")).toEqual(rawOutput);
		expect(mocks.run).not.toHaveBeenCalled();
		expect(result.citations).toEqual([]);
	});
	it("validates exact identifiers and language before touching data", async () => {
		await expect(getPromptMeasurementDetailFn({ data: { ...scope, runId: "not-a-uuid" } })).rejects.toThrow();
		await expect(
			getPromptMeasurementDetailFn({ data: { ...scope, runId, language: "injected-language" } }),
		).rejects.toThrow();
		await expect(
			getPromptMeasurementsFn({ data: { ...scope, lookback: "custom:2026-02-31:2026-03-01" } }),
		).rejects.toThrow();
		expect(mocks.auth).not.toHaveBeenCalled();
	});
});
