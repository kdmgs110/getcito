import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	prompt: vi.fn(),
	brand: vi.fn(),
	competitors: vi.fn(),
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
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@/lib/app-locale", async (original) => ({
	...(await original<typeof import("@/lib/app-locale")>()),
	APP_TIMEZONE: "Asia/Tokyo",
}));
vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: {
			prompts: { findFirst: mocks.prompt },
			brands: { findFirst: mocks.brand },
			competitors: { findMany: mocks.competitors },
		},
		selectDistinctOn: mocks.select,
	},
}));

import { getPromptBrandMentionsFn, mentionTargetCondition } from "./brand-mentions-read";

const promptId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const input = { brandId: "ours", promptId, lookback: "all" };
let scope: SQL;
const answer = {
	id: runId,
	model: "chatgpt",
	provider: "dataforseo-scraper",
	createdAt: new Date("2026-11-03T00:00:00Z"),
	mentionAnalysis: null,
	evidence: { answerStatus: "shown", answerText: "1. Other Brand\n2. Our Brand\n3. New Agent" },
	rawOutput: null,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.auth.mockResolvedValue({ user: { id: "member" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.prompt.mockResolvedValue({ id: promptId });
	mocks.brand.mockResolvedValue({
		id: "ours",
		name: "Our Brand",
		website: "https://ours.example",
		additionalDomains: [],
		aliases: [],
	});
	mocks.competitors.mockResolvedValue([{ id: "other", name: "Other Brand", aliases: [], domains: [] }]);
	mocks.select.mockReturnValue({
		from: () => ({
			leftJoin: () => ({
				where: (condition: SQL) => {
					scope = condition;
					return { orderBy: () => ({ limit: () => Promise.resolve([answer]) }) };
				},
			}),
		}),
	});
});

describe("stored answer brand mentions", () => {
	it("requires authentication and organization access before reading answers", async () => {
		mocks.auth.mockRejectedValueOnce(new Error("Unauthorized"));
		await expect(getPromptBrandMentionsFn({ data: input })).rejects.toThrow("Unauthorized");
		expect(mocks.prompt).not.toHaveBeenCalled();
		mocks.access.mockRejectedValueOnce(new Error("Forbidden"));
		await expect(getPromptBrandMentionsFn({ data: input })).rejects.toThrow("Forbidden");
		expect(mocks.select).not.toHaveBeenCalled();
	});
	it("rejects prompts outside the authorized brand", async () => {
		mocks.prompt.mockResolvedValueOnce(undefined);
		await expect(getPromptBrandMentionsFn({ data: input })).rejects.toThrow("Prompt not found");
		expect(mocks.select).not.toHaveBeenCalled();
	});
	it("enriches historical answers with global ranks and classifications without acquisition", async () => {
		const result = await getPromptBrandMentionsFn({ data: input });
		expect(result.answers[0].mentionAnalysis.mentions.map((m) => [m.name, m.kind, m.rank])).toEqual([
			["Other Brand", "competitor", 1],
			["Our Brand", "own", 2],
			["New Agent", "unregistered", 3],
		]);
		expect(result.answers[0]).toMatchObject({
			runId,
			modelLabel: "ChatGPT Web",
			answerText: answer.evidence.answerText,
		});
	});
	it("retains exact selected run, target, prompt, brand, language and date scope", async () => {
		await getPromptBrandMentionsFn({
			data: {
				...input,
				runId,
				attemptId: runId,
				targetKey: "chatgpt:dataforseo-scraper:online",
				language: "ja",
				lookback: "custom:2026-11-01:2026-11-03",
			},
		});
		const query = new PgDialect().sqlToQuery(scope);
		for (const value of ["ours", promptId, runId, "chatgpt:dataforseo-scraper:online", "ja", "Asia/Tokyo"])
			expect(query.params).toContain(value);
		expect(query.sql).toContain("linked.prompt_run_id");
		expect(query.sql).toContain('"prompt_runs"."request_context"');
		expect(query.sql).toContain('"measurement_attempts"."id" =');
	});
	it("an exact historical target takes precedence over the retained model filter", async () => {
		await getPromptBrandMentionsFn({
			data: {
				...input,
				runId,
				targetKey: 'legacy:["chatgpt","brightdata","v1",true]',
				model: "chatgpt:dataforseo-scraper:online",
			},
		});
		const query = new PgDialect().sqlToQuery(scope);
		expect(query.params).toContain("brightdata");
		expect(query.params).not.toContain("chatgpt:dataforseo-scraper:online");
	});
	it("validates input and legacy identity rather than guessing another target", () => {
		const legacy = mentionTargetCondition('legacy:["chatgpt","brightdata","v1",true]');
		const query = new PgDialect().sqlToQuery(legacy as SQL);
		expect(query.params).toEqual(["chatgpt", "brightdata", "v1", true]);
		expect(() => mentionTargetCondition("legacy:garbage")).toThrow();
		expect(() => mentionTargetCondition('legacy:["chatgpt"]')).toThrow();
	});
});
