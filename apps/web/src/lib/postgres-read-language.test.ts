import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() =>
	vi.fn(async (_query: unknown): Promise<{ rows: Record<string, unknown>[] }> => ({ rows: [] })),
);
vi.mock("@workspace/lib/db/db", () => ({ db: { execute } }));
// A second pool would bypass the Heroku TLS policy and connection ceiling.
vi.mock("drizzle-orm/node-postgres", () => ({
	drizzle: () => {
		throw new Error("Unexpected analytics database pool");
	},
}));

import {
	getBatchChartData,
	getBrandEarliestRunDate,
	getBrandMentionRateByModel,
	getDashboardSummary,
	getFanoutBreakdown,
	getFanoutModelTotals,
	getFanoutPromptTotals,
	getPromptCitationUrlStats,
	getPromptMentionSummary,
	getPromptsFirstEvaluatedAt,
	getPromptsSummary,
	getPromptTopCompetitorMentions,
	getPromptWebQueriesForMapping,
} from "./postgres-read";

const dialect = new PgDialect();
const promptId = "12345678-1234-1234-1234-123456789abc";
const runQueries = async (language?: string) => {
	await getPromptCitationUrlStats(promptId, "2026-10-01", "2026-10-31", "Asia/Tokyo", language);
	for (const query of [getFanoutBreakdown, getFanoutModelTotals, getFanoutPromptTotals]) {
		await query("brand", "2026-10-01", "2026-10-31", "Asia/Tokyo", [promptId], "chatgpt", language);
	}
	return execute.mock.calls.map(([query]) => dialect.sqlToQuery(query as SQL));
};
describe("consistent language scope for prompt citations and search queries", () => {
	beforeEach(() => execute.mockClear());
	it("filters citation rows by their run snapshot and all fanout numerators/denominators by the same language", async () => {
		const queries = await runQueries("ja");
		expect(queries).toHaveLength(4);
		for (const query of queries) {
			expect(query.sql).toContain("pr.request_context->>'languageCode' =");
			expect(query.params).toContain("ja");
		}
		expect(queries[0].sql).toContain("pr.id = citations.prompt_run_id");
	});
	it("keeps legacy-unrecorded distinct from recorded requests with no language", async () => {
		for (const query of await runQueries("unrecorded")) expect(query.sql).toContain("pr.request_context IS NULL");
		execute.mockClear();
		for (const query of await runQueries("unspecified")) {
			expect(query.sql).toContain("pr.request_context IS NOT NULL AND pr.request_context->>'languageCode' IS NULL");
		}
	});
	it("keeps all languages while excluding retired acquisitions", async () => {
		const [citationQuery] = await runQueries();
		expect(citationQuery.sql).toContain("scoped_run.id = citations.prompt_run_id");
		expect(citationQuery.sql).toContain("brightdata");
		expect(citationQuery.sql).not.toContain("request_context");
	});
});

describe("analytics database connection", () => {
	it("reads overview, summaries and charts through the shared TLS-configured pool", async () => {
		execute.mockReset();
		execute.mockResolvedValueOnce({ rows: [{ total_prompts: 10, total_runs: 10, avg_visibility: 90 }] });
		expect(await getDashboardSummary("brand", "2026-10-01", "2026-10-31", "Asia/Tokyo")).toMatchObject([
			{ total_runs: 10 },
		]);
		execute.mockResolvedValue({ rows: [] });
		expect(await getPromptsSummary("brand", null, null, "Asia/Tokyo")).toEqual([]);
		expect(await getBatchChartData("brand", [promptId], null, null, "Asia/Tokyo")).toEqual([]);
		expect(execute).toHaveBeenCalledTimes(4);
	});
});

describe("current analytics exclude retired acquisitions", () => {
	beforeEach(() => execute.mockClear());
	it("scopes summary, history dates, mappings and snapshots without deleting historical rows", async () => {
		await getDashboardSummary("brand", null, null, "Asia/Tokyo");
		await getPromptsFirstEvaluatedAt("brand", [promptId]);
		await getPromptWebQueriesForMapping(promptId, null, null, "Asia/Tokyo");
		await getPromptMentionSummary(promptId, "2026-10-01", "2026-10-31", "Asia/Tokyo");
		await getPromptTopCompetitorMentions(promptId, "2026-10-01", "2026-10-31", "Asia/Tokyo", 5);
		await getBrandMentionRateByModel("brand", "2026-10-01", "2026-10-31", "Asia/Tokyo", [promptId]);
		await getBrandEarliestRunDate("brand");
		expect(execute).toHaveBeenCalledTimes(7);
		for (const [query] of execute.mock.calls) {
			const { sql: text } = dialect.sqlToQuery(query as SQL);
			expect(text).toContain("brightdata");
			expect(text).toContain("'olostep','cloro','oxylabs'");
			expect(text).not.toMatch(/DELETE|UPDATE/);
		}
	});
});
