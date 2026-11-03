import { WEB_QUERIES_UNAVAILABLE } from "@workspace/lib/constants";
import type { MeasurementEvidence } from "@workspace/lib/measurement";
import { normalizeEvidencePage } from "@workspace/lib/page-evidence";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), select: vi.fn(), latest: vi.fn(), brand: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (value: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@workspace/lib/db/db", () => ({
	db: { select: mocks.select, selectDistinctOn: mocks.latest, query: { brands: { findFirst: mocks.brand } } },
}));

import { buildSpreadsheetAnswer, getVisibilitySpreadsheetRowsFn, type SpreadsheetRun } from "./visibility-spreadsheet";

const promptId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const asOf = "2026-11-03T05:00:00.000Z";
const data = { brandId: "our-brand", promptIds: [promptId], lookback: "1m", asOf };
const run = (): SpreadsheetRun & { evidence: MeasurementEvidence } => ({
	id: "00000000-0000-4000-8000-000000000003",
	promptId,
	model: "chatgpt",
	provider: "dataforseo-scraper",
	createdAt: new Date("2026-11-03T01:00:00Z"),
	webSearchEnabled: true,
	brandMentioned: true,
	competitorsMentioned: ["Competitor", "Competitor"],
	webQueries: ["Rails 案件", "not_exposed"],
	rawOutput: null,
	evidence: {
		version: 1,
		answerText: "完全な回答\n2行目",
		answerStatus: "shown",
		queryStatus: "observed",
		queryEvidence: [],
	},
});
const statements: SQL[] = [];
function selection(result: unknown[]) {
	return {
		from: () => ({
			where: (where: SQL) => {
				statements.push(where);
				return Promise.resolve(result);
			},
		}),
	};
}
function latestSelection(result: SpreadsheetRun[]) {
	return {
		from: () => ({
			leftJoin: () => ({
				where: (where: SQL) => {
					statements.push(where);
					return {
						orderBy: () => Promise.resolve(result),
					};
				},
			}),
		}),
	};
}
const sqlText = () => statements.map((statement) => new PgDialect().sqlToQuery(statement));

beforeEach(() => {
	vi.clearAllMocks();
	statements.length = 0;
	mocks.auth.mockResolvedValue({ user: { id: "member" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.brand.mockResolvedValue({ name: "Our Brand" });
	mocks.select
		.mockReturnValueOnce(selection([{ id: promptId, value: "Rails 案件", tags: ["フルリモート"] }]))
		.mockReturnValueOnce(selection([]));
	mocks.latest.mockReturnValue(latestSelection([run()]));
});

describe("visibility spreadsheet authorization and batching", () => {
	it("rejects unauthenticated users before database reads", async () => {
		mocks.auth.mockRejectedValue(new Error("Unauthorized"));
		await expect(getVisibilitySpreadsheetRowsFn({ data })).rejects.toThrow("Unauthorized");
		expect(mocks.access).not.toHaveBeenCalled();
		expect(mocks.select).not.toHaveBeenCalled();
	});
	it("rejects another organization's brand before database reads", async () => {
		mocks.access.mockRejectedValue(new Error("Forbidden"));
		await expect(getVisibilitySpreadsheetRowsFn({ data })).rejects.toThrow("Forbidden");
		expect(mocks.access).toHaveBeenCalledExactlyOnceWith("member", "our-brand");
		expect(mocks.select).not.toHaveBeenCalled();
	});
	it("caps every batch at 20 IDs and validates dates and IDs", async () => {
		await expect(
			getVisibilitySpreadsheetRowsFn({ data: { ...data, promptIds: Array(21).fill(promptId) } }),
		).rejects.toThrow();
		await expect(getVisibilitySpreadsheetRowsFn({ data: { ...data, promptIds: ["invalid"] } })).rejects.toThrow();
		await expect(getVisibilitySpreadsheetRowsFn({ data: { ...data, asOf: "invalid" } })).rejects.toThrow();
		expect(mocks.auth).not.toHaveBeenCalled();
	});
	it("returns only brand-owned enabled prompts in requested order without N+1 reads", async () => {
		mocks.select
			.mockReset()
			.mockReturnValueOnce(
				selection([
					{ id: promptId, value: "Rails 案件", tags: ["フルリモート"] },
					{ id: otherId, value: "副業", tags: [] },
				]),
			)
			.mockReturnValueOnce(selection([]));
		const response = await getVisibilitySpreadsheetRowsFn({
			data: { ...data, promptIds: [otherId, promptId, otherId] },
		});
		expect(response.asOf).toBe(asOf);
		expect(response.rows.map((row) => row.id)).toEqual([otherId, promptId]);
		expect(response.rows[0]).toMatchObject({ chatgpt: null, aiMode: null, lastRunAt: null });
		expect(response.rows[1]).toMatchObject({ tags: ["フルリモート"], lastRunAt: "2026-11-03T01:00:00.000Z" });
		expect(mocks.select).toHaveBeenCalledTimes(2);
		expect(mocks.latest).toHaveBeenCalledTimes(1);
		const [promptScope, runScope] = sqlText();
		expect(promptScope.sql).toContain('"prompts"."brand_id" =');
		expect(promptScope.sql).toContain('"prompts"."enabled" =');
		expect(runScope.sql).toContain('"prompt_runs"."brand_id" =');
		expect(runScope.params).toContain("our-brand");
		expect(runScope.params).toContain("dataforseo-scraper");
		expect(runScope.params).toContain("google-ai-mode");
		expect(runScope.sql).toContain("<> 'brightdata'");
		expect(runScope.sql).toContain('"prompt_runs"."created_at" <=');
	});
	it("omits foreign/deleted prompt IDs and does not query runs for them", async () => {
		mocks.select.mockReset().mockReturnValue(selection([]));
		await expect(getVisibilitySpreadsheetRowsFn({ data })).resolves.toEqual({ rows: [], asOf });
		expect(mocks.latest).not.toHaveBeenCalled();
	});
	it("uses the latest of the two engine result dates", async () => {
		mocks.latest.mockReturnValue(
			latestSelection([
				run(),
				{ ...run(), id: otherId, model: "google-ai-mode", createdAt: new Date("2026-11-03T02:00:00Z") },
			]),
		);
		const response = await getVisibilitySpreadsheetRowsFn({ data });
		expect(response.rows[0].lastRunAt).toBe("2026-11-03T02:00:00.000Z");
		expect(response.rows[0].aiMode?.runId).toBe(otherId);
	});
});

describe("spreadsheet answer evidence", () => {
	it("preserves full answer and existing brand names while deduplicating queries and mentions", () => {
		const input = run();
		input.webQueries = ["Rails 案件", "Rails 案件", WEB_QUERIES_UNAVAILABLE];
		input.evidence.queryEvidence = [{ query: "Rails 副業", urls: [], sourceField: "queries" }];
		const result = buildSpreadsheetAnswer(input, [], "Our Brand");
		expect(result.answerText).toBe("完全な回答\n2行目");
		expect(result.mentionedBrands).toEqual(["Our Brand", "Competitor"]);
		expect(result.webQueries).toEqual(["Rails 案件", "Rails 副業"]);
	});
	it("counts reported search occurrences and citations per normalized page and domain without double-counting stored receipts", () => {
		const input = run();
		const page = normalizeEvidencePage("https://www.example.com/a?utm_source=x", "provider");
		const second = normalizeEvidencePage("https://example.com/b", "provider");
		if (!page || !second) throw new Error("Invalid fixture URL");
		input.evidence.pageEvidence = {
			version: 1,
			search: { status: "known", sourceField: "provider", items: [page, page, second] },
			citations: { status: "known", sourceField: "provider", items: [page] },
		};
		const result = buildSpreadsheetAnswer(input, [{ promptRunId: input.id, url: page.url, title: null }], "Our Brand");
		expect(result.pages).toEqual([
			{ url: "https://www.example.com/a", domain: "example.com", title: "", appearances: 2, citations: 1 },
			{ url: "https://example.com/b", domain: "example.com", title: "", appearances: 1, citations: 0 },
		]);
		expect(result.domains).toEqual([{ domain: "example.com", appearances: 3, citations: 1 }]);
	});
	it("keeps unexposed search counts unknown when only legacy citations are available", () => {
		const input = run();
		input.webQueries = [];
		input.evidence.queryStatus = "not_exposed";
		const result = buildSpreadsheetAnswer(
			input,
			[
				{ promptRunId: input.id, url: "https://example.com/a", title: "Page" },
				{ promptRunId: input.id, url: "javascript:alert(1)", title: null },
			],
			"Our Brand",
		);
		expect(result.queryStatus).toBe("not_exposed");
		expect(result.searchResultsStatus).toBe("unknown");
		expect(result.pages).toEqual([
			{ url: "https://example.com/a", domain: "example.com", title: "Page", appearances: null, citations: 1 },
		]);
	});
	it("recovers pages from older provider receipts even when normalized answer evidence already exists", () => {
		const input = run();
		input.rawOutput = {
			status_code: 20000,
			tasks: [
				{
					status_code: 20000,
					result: [
						{
							markdown: "Legacy answer",
							search_results: [{ url: "https://example.com/a" }],
							sources: [{ url: "https://example.com/a" }],
						},
					],
				},
			],
		};
		const result = buildSpreadsheetAnswer(input, [], "Our Brand");
		expect(result.pages).toEqual([
			{ url: "https://example.com/a", domain: "example.com", title: "", appearances: 1, citations: 1 },
		]);
		expect(result.answerText).toBe("完全な回答\n2行目");
	});
	it("does not invent a zero, search query, or answer for unavailable evidence", () => {
		const input = run();
		input.webQueries = [];
		input.evidence = {
			version: 1,
			answerText: "provider message",
			answerStatus: "not_shown",
			queryStatus: "unknown",
			queryEvidence: [],
		};
		const result = buildSpreadsheetAnswer(input, [], "Our Brand");
		expect(result).toMatchObject({
			answerText: "",
			answerStatus: "not_shown",
			queryStatus: "unknown",
			searchResultsStatus: "unknown",
			citationsStatus: "unknown",
			pages: [],
			domains: [],
			webQueries: [],
		});
	});
	it("extracts legacy Google AI Mode answers without exposing provider JSON", () => {
		const input = {
			...run(),
			model: "google-ai-mode",
			provider: "dataforseo",
			evidence: null,
			rawOutput: { tasks: [{ result: [{ items: [{ type: "ai_overview", markdown: "Googleの回答" }] }] }] },
		};
		const result = buildSpreadsheetAnswer(input, [], "Our Brand");
		expect(result.answerText).toBe("Googleの回答");
		expect(result).not.toHaveProperty("rawOutput");
	});
	it("keeps a missing legacy Google answer unknown instead of showing extractor diagnostics", () => {
		const input = { ...run(), model: "google-ai-mode", provider: "dataforseo", evidence: null, rawOutput: {} };
		expect(buildSpreadsheetAnswer(input, [], "Our Brand")).toMatchObject({ answerText: "", answerStatus: "unknown" });
	});
});
