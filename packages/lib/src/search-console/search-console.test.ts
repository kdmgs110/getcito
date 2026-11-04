import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AI_QUESTION_REGEX,
	buildSearchConsoleFilters,
	defaultSearchConsoleDates,
	getAiQuestionSignals,
	LONG_JAPANESE_QUERY_REGEX,
	propertyMatchesHosts,
	reportFiltersSchema,
	type SearchConsoleFilters,
	searchConsoleToday,
} from "./index";
import { fetchSearchConsoleReport, listSearchConsoleSites } from "./server";

const input: SearchConsoleFilters = {
	startDate: "2026-10-01",
	endDate: "2026-10-28",
	keyword: "",
	aiQuestionsOnly: false,
	urlConditions: [],
};
const metric = { clicks: 3, impressions: 100, ctr: 0.03, position: 8.2 };
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Query = {
	dimensions: string[];
	rowLimit: number;
	startRow: number;
	dimensionFilterGroups: {
		groupType: string;
		filters: { dimension: string; operator: string; expression: string }[];
	}[];
};
function mockReports(handler: (body: Query) => Response) {
	const requests: Query[] = [];
	const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
		const body = JSON.parse(options.body as string) as Query;
		requests.push(body);
		return handler(body);
	});
	vi.stubGlobal("fetch", fetcher);
	return { requests, fetcher };
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Search Console filter validation", () => {
	it("preserves the original fourteen-Japanese-character rule", () => {
		const regex = new RegExp(LONG_JAPANESE_QUERY_REGEX);
		expect(regex.test("あ".repeat(13))).toBe(false);
		expect(regex.test("あ".repeat(14))).toBe(true);
		expect(regex.test(Array.from({ length: 14 }, () => "漢ABC123?").join(" "))).toBe(true);
		expect(regex.test("ー々ｱ".repeat(20))).toBe(false);
	});
	it.each([
		"案件を教えて",
		"案件を教えてください。",
		"おすすめしてもらえますか？",
		"なぜ失敗する",
		"どうすればいい",
		"独立できる？",
		"独立できる?　",
		"未経験ですが案件はある",
		"週２日で働く",
		"私に合う案件",
		"a b c d",
		"東京　副業　求人　在宅",
		"  a   b　c\td  ",
		"あ".repeat(14),
	])("extracts a supported candidate with the same regex used by Google: %s", (query) => {
		expect(new RegExp(AI_QUESTION_REGEX).test(query)).toBe(true);
		expect(getAiQuestionSignals(query).score).toBeGreaterThan(0);
	});
	it.each([
		"a b c",
		"a    b    c   ",
		"この本について",
		"東京 求人",
		"おすすめ",
		"あ".repeat(13),
	])("does not mistake trailing te, repeated whitespace, or short keyword fragments for a match: %s", (query) => {
		expect(new RegExp(AI_QUESTION_REGEX).test(query)).toBe(false);
		expect(getAiQuestionSignals(query)).toEqual({ score: 0, reasons: [] });
	});
	it("counts each reason once, caps priority, and keeps the Google expression under its limit", () => {
		expect(getAiQuestionSignals("教えて教えて")).toEqual({ score: 40, reasons: ["request"] });
		expect(getAiQuestionSignals("a b c d")).toEqual({ score: 10, reasons: ["fourTerms"] });
		expect(getAiQuestionSignals("あ".repeat(14))).toEqual({ score: 5, reasons: ["longJapanese"] });
		expect(getAiQuestionSignals("未経験ですが 週2日で 私に合う 案件をどうやって探すか教えて？").score).toBe(100);
		expect(AI_QUESTION_REGEX.length).toBeLessThanOrEqual(4096);
	});
	it("defaults to all queries and validates real dates, PT boundaries and the sixteen month window", () => {
		expect(reportFiltersSchema.parse({ startDate: input.startDate, endDate: input.endDate })).toMatchObject({
			aiQuestionsOnly: false,
			keyword: "",
			urlConditions: [],
		});
		for (const patch of [
			{ startDate: "2026-02-30" },
			{ startDate: "2026-11-01" },
			{ endDate: "2026-11-05" },
			{ startDate: "2025-07-04" },
			{ endDate: "2026-13-01" },
		])
			expect(reportFiltersSchema.safeParse({ ...input, ...patch }).success).toBe(false);
		expect(reportFiltersSchema.safeParse({ ...input, startDate: "2025-07-05" }).success).toBe(true);
		expect(searchConsoleToday(new Date("2026-11-05T02:00:00Z"))).toBe("2026-11-04");
		expect(defaultSearchConsoleDates(new Date("2026-11-05T02:00:00Z"))).toEqual({
			startDate: "2026-10-05",
			endDate: "2026-11-01",
		});
	});
	it("requires explicit full URLs for exact and subtree, and allows substring paths", () => {
		for (const value of ["/jobs", "javascript:alert(1)", "https://u:p@example.com/", "https://example.com/#x"])
			expect(reportFiltersSchema.safeParse({ ...input, urlConditions: [{ operator: "equals", value }] }).success).toBe(
				false,
			);
		expect(
			reportFiltersSchema.safeParse({
				...input,
				urlConditions: [{ operator: "subtree", value: "https://example.com/jobs/?x=1" }],
			}).success,
		).toBe(false);
		expect(
			reportFiltersSchema.parse({ ...input, urlConditions: [{ operator: "contains", value: "/jobs" }] })
				.urlConditions[0].value,
		).toBe("/jobs");
		expect(
			reportFiltersSchema.safeParse({
				...input,
				urlConditions: Array.from({ length: 11 }, () => ({ operator: "contains", value: "/" })),
			}).success,
		).toBe(false);
	});
	it("matches properties only to allowed brand hosts and strictly scopes domain-property reports", () => {
		expect(propertyMatchesHosts("sc-domain:example.com", ["www.example.com"])).toBe(true);
		expect(propertyMatchesHosts("sc-domain:example.com", ["evil-example.com"])).toBe(false);
		expect(propertyMatchesHosts("https://other.example.com/", ["www.example.com"])).toBe(false);
		expect(propertyMatchesHosts("https://www.example.com/blog/", ["www.example.com"])).toBe(true);
		const regex = new RegExp(buildSearchConsoleFilters(["www.example.com"], input)[0].expression);
		expect(regex.test("https://www.example.com/jobs/")).toBe(true);
		for (const url of [
			"https://other.example.com/",
			"https://www.example.com.evil.test/",
			"https://wwwXexample.com/",
			"https://www.example.com:9999/",
		])
			expect(regex.test(url)).toBe(false);
		expect(() => buildSearchConsoleFilters([], input)).toThrow("GSC_PROPERTY_FORBIDDEN");
	});
	it("includes directory root and descendants while escaping regex and respecting path boundaries", () => {
		const filters = buildSearchConsoleFilters(["example.com"], {
			...input,
			urlConditions: [{ operator: "subtree", value: "https://example.com/jobs+(new)/" }],
		});
		const regex = new RegExp(filters[1].expression);
		for (const url of [
			"https://example.com/jobs+(new)",
			"https://example.com/jobs+(new)/x",
			"https://example.com/jobs+(new)?x=1",
		])
			expect(regex.test(url)).toBe(true);
		for (const url of ["https://example.com/jobs+(new)-old/", "https://example.com/jobssnew/"])
			expect(regex.test(url)).toBe(false);
	});
});

describe("Search Console API", () => {
	it("combines mandatory host, keyword, AI regex, and all URL filters with AND for rows and API totals", async () => {
		const { requests, fetcher } = mockReports((body) =>
			json({ rows: body.dimensions.length ? [{ ...metric, keys: ["質問内容の例"] }] : [{ ...metric, clicks: 100 }] }),
		);
		const result = await fetchSearchConsoleReport("secret", "sc-domain:example.com", ["www.example.com"], {
			...input,
			keyword: "フリーランス",
			aiQuestionsOnly: true,
			urlConditions: [
				{ operator: "contains", value: "/jobs" },
				{ operator: "notContains", value: "/archive" },
				{ operator: "equals", value: "https://www.example.com/jobs/" },
				{ operator: "subtree", value: "https://www.example.com/jobs/" },
			],
		});
		expect(result.totals.clicks).toBe(100);
		expect(result.rows[0].clicks).toBe(3);
		expect(result.truncated).toBe(false);
		expect(requests).toHaveLength(2);
		expect(requests[0]).toMatchObject({ dimensions: [], type: "web", dataState: "final", aggregationType: "auto" });
		expect(requests[0].dimensionFilterGroups).toEqual(requests[1].dimensionFilterGroups);
		expect(requests[1].dimensionFilterGroups[0]).toMatchObject({
			groupType: "and",
			filters: [
				{ dimension: "page", operator: "includingRegex" },
				{ dimension: "query", operator: "contains", expression: "フリーランス" },
				{ dimension: "query", operator: "includingRegex", expression: AI_QUESTION_REGEX },
				{ dimension: "page", operator: "contains", expression: "/jobs" },
				{ dimension: "page", operator: "notContains", expression: "/archive" },
				{ dimension: "page", operator: "equals" },
				{ dimension: "page", operator: "includingRegex" },
			],
		});
		expect(fetcher.mock.calls[0][0]).toBe(
			"https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
		);
	});
	it("omits query regex entirely when AI question filtering is off", async () => {
		const { requests } = mockReports(() => json({ rows: [] }));
		await fetchSearchConsoleReport("secret", "https://example.com/", ["example.com"], input);
		expect(requests[0].dimensionFilterGroups[0].filters).toHaveLength(1);
	});
	it.each([
		false,
		true,
	])("paginates to 50,000 and probes one extra row for accurate truncation (%s)", async (hasMore) => {
		const { requests } = mockReports((body) =>
			json({
				rows: !body.dimensions.length
					? [metric]
					: body.startRow === 50_000
						? hasMore
							? [{ ...metric, keys: ["extra"] }]
							: []
						: Array.from({ length: 25_000 }, (_, i) => ({ ...metric, keys: [`query-${body.startRow + i}`] })),
			}),
		);
		const result = await fetchSearchConsoleReport("secret", "https://example.com/", ["example.com"], input);
		expect(result.rows).toHaveLength(50_000);
		expect(result.truncated).toBe(hasMore);
		expect(requests.filter((body) => body.dimensions.length).map((body) => [body.startRow, body.rowLimit])).toEqual([
			[0, 25_000],
			[25_000, 25_000],
			[50_000, 1],
		]);
	});
	it("rejects unrelated properties without sending credentials", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(fetchSearchConsoleReport("secret", "sc-domain:evil.com", ["example.com"], input)).rejects.toThrow(
			"GSC_PROPERTY_FORBIDDEN",
		);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each([
		[401, "GSC_RECONNECT_REQUIRED"],
		[403, "GSC_PROPERTY_FORBIDDEN"],
		[429, "GSC_RATE_LIMITED"],
		[500, "GSC_UNAVAILABLE"],
	])("sanitizes provider errors for status %s without retries", async (status, code) => {
		const fetcher = vi.fn(async () =>
			json({ error: { message: "secret token and provider internals" } }, status as number),
		);
		vi.stubGlobal("fetch", fetcher);
		await expect(listSearchConsoleSites("secret")).rejects.toThrow(code as string);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("recognizes 403 quota exhaustion, sanitizes network and malformed data errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403)),
		);
		await expect(listSearchConsoleSites("secret")).rejects.toThrow("GSC_RATE_LIMITED");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("secret network detail");
			}),
		);
		await expect(listSearchConsoleSites("secret")).rejects.toThrow("GSC_UNAVAILABLE");
		mockReports(() => json({ rows: [{ ...metric, clicks: "invalid" }] }));
		await expect(fetchSearchConsoleReport("secret", "https://example.com/", ["example.com"], input)).rejects.toThrow(
			"GSC_UNAVAILABLE",
		);
	});
	it("lists only verified readable sites", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				json({
					siteEntry: [
						{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
						{ siteUrl: "sc-domain:example.com", permissionLevel: "siteRestrictedUser" },
						{ siteUrl: "https://other.com/", permissionLevel: "siteUnverifiedUser" },
					],
				}),
			),
		);
		expect(await listSearchConsoleSites("secret")).toHaveLength(2);
	});
});
