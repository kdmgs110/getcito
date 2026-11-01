import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	prompt: vi.fn(),
	select: vi.fn(),
	calls: [] as Array<{ selection: unknown; where: unknown }>,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (x: unknown) => unknown }) => ({
			handler: (fn: (x: { data: unknown }) => unknown) => async (x: { data: unknown }) =>
				fn({ data: schema.parse(x.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@workspace/lib/db/db", () => ({
	db: { query: { prompts: { findFirst: mocks.prompt } }, select: mocks.select },
}));
import { getPromptPageEvidenceFn } from "./prompt-page-evidence";
const promptId = "00000000-0000-4000-8000-000000000001",
	runId = "00000000-0000-4000-8000-000000000002";
const scope = {
	brandId: "ours",
	promptId,
	language: "ja",
	lookback: "custom:2026-10-01:2026-11-01",
	targetKey: "chatgpt:dataforseo-scraper:online",
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.calls.length = 0;
	mocks.auth.mockResolvedValue({ user: { id: "user" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.prompt.mockResolvedValue({ id: promptId });
	mocks.select.mockImplementation((selection) => ({
		from: () => ({
			leftJoin: () => ({
				where: (where: unknown) => {
					mocks.calls.push({ selection, where });
					return { orderBy: async () => [] };
				},
			}),
		}),
	}));
});
describe("page evidence read authorization and scope", () => {
	it("rejects non-members and foreign prompts before querying evidence", async () => {
		mocks.access.mockRejectedValueOnce(Error("Forbidden"));
		await expect(getPromptPageEvidenceFn({ data: scope })).rejects.toThrow("Forbidden");
		expect(mocks.prompt).not.toHaveBeenCalled();
		mocks.prompt.mockResolvedValueOnce(null);
		await expect(getPromptPageEvidenceFn({ data: scope })).rejects.toThrow("Prompt not found");
		expect(mocks.select).not.toHaveBeenCalled();
	});
	it("validates exact ids and locale before any access", async () => {
		await expect(getPromptPageEvidenceFn({ data: { ...scope, promptId: "invalid" } })).rejects.toThrow();
		expect(mocks.auth).not.toHaveBeenCalled();
	});
	it("restricts metadata to brand/prompt/date/language and never selects raw or prose", async () => {
		const result = await getPromptPageEvidenceFn({ data: scope });
		expect(result.pages.totalAnswers).toBe(0);
		const q = new PgDialect().sqlToQuery(mocks.calls[0].where as SQL);
		expect(q.params).toEqual(expect.arrayContaining(["ours", promptId, "ja", "2026-10-01", "2026-11-01"]));
		expect(Object.keys(mocks.calls[0].selection as object)).not.toContain("rawOutput");
		expect(mocks.access).toHaveBeenCalledWith("user", "ours");
	});
	it("reconstructs stored result fields for the selected answer and returns distinct-answer counts", async () => {
		const r = {
			id: runId,
			attemptId: null,
			targetKey: null,
			model: "chatgpt",
			provider: "dataforseo-scraper",
			version: "web",
			webSearch: true,
			createdAt: new Date("2026-10-31T01:00:00Z"),
			requestContext: { languageCode: "ja", countryCode: "JP" },
			queries: ["Rails"],
			queryEvidence: [],
		};
		mocks.select
			.mockImplementationOnce(() => ({
				from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: async () => [r] }) }) }),
			}))
			.mockImplementationOnce(() => ({
				from: () => ({
					leftJoin: () => ({
						where: async () => [
							{
								id: runId,
								evidence: null,
								raw: {
									status_code: 20000,
									tasks: [
										{
											status_code: 20000,
											result: [
												{
													markdown: "answer",
													search_results: [{ url: "https://example.com/a" }, { url: "https://example.com/a" }],
													sources: [{ url: "https://example.com/a" }],
												},
											],
										},
									],
								},
							},
						],
					}),
				}),
			}));
		const result = await getPromptPageEvidenceFn({ data: { ...scope, targetKey: undefined } });
		expect(result.pages.totalAnswers).toBe(1);
		expect(result.pages.rows[0]).toMatchObject({
			searchAnswers: 1,
			searchOccurrences: 2,
			citationAnswers: 1,
			transitionAnswers: 1,
			transitionSearchAnswers: 1,
		});
	});
});
