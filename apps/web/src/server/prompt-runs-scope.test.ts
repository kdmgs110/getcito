import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), countWhere: vi.fn(), access: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (input: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({
	requireAuthSession: async () => ({ user: { id: "member" } }),
	requireOrgAccess: mocks.access,
}));
vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { prompts: { findFirst: async () => ({ brandId: "brand" }) } },
		select: (fields?: object) => ({
			from: () => ({
				where: fields
					? mocks.countWhere
					: (where: unknown) => {
							mocks.findMany(where);
							return {
								orderBy: () => ({
									limit: () => ({
										offset: async () => [
											{
												id: "zero-mention-answer",
												brandMentioned: false,
												competitorsMentioned: [],
												rawOutput: { answer: "Collected answer" },
											},
										],
									}),
								}),
							};
						},
			}),
		}),
	},
}));
vi.mock("@/lib/postgres-read", () => ({}));
vi.mock("@/lib/domain-categories.server", () => ({ classifyUrl: vi.fn() }));
import { getPromptRunsFn } from "./prompts";
const dialect = new PgDialect();

beforeEach(() => {
	vi.clearAllMocks();
	mocks.countWhere.mockResolvedValue([{ count: 1 }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("prompt answer history target scope", () => {
	it("keeps zero-mention answers and applies the exact same target to rows and pagination", async () => {
		vi.stubEnv("SCRAPE_TARGETS", "google-ai-mode:dataforseo:online,chatgpt:brightdata:online");
		const result = await getPromptRunsFn({ data: { promptId: "prompt", model: "google-ai-mode:dataforseo:online" } });
		expect(result.runs).toMatchObject([{ id: "zero-mention-answer", brandMentioned: false }]);
		expect(result.total).toBe(1);
		const rowQuery = dialect.sqlToQuery(mocks.findMany.mock.calls[0][0]);
		const countQuery = dialect.sqlToQuery(mocks.countWhere.mock.calls[0][0]);
		expect(rowQuery).toEqual(countQuery);
		expect(rowQuery.params).toContain("google-ai-mode:dataforseo:online");
		expect(rowQuery.sql).toContain("mt.target_key");
		expect(rowQuery.sql).not.toContain("brand_mentioned");
		expect(mocks.access).toHaveBeenCalledWith("member", "brand");
	});
	it.each([undefined, "all"])("preserves all-target history for model %s", async (model) => {
		await getPromptRunsFn({ data: { promptId: "prompt", model } });
		const query = dialect.sqlToQuery(mocks.findMany.mock.calls[0][0]);
		expect(query.sql).not.toContain("measurement_attempts");
		expect(query.sql).not.toContain(".model");
	});
});
