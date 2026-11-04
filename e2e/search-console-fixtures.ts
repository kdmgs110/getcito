/** Cached GSC reports exercise the authenticated UI without contacting Google. */
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { require as tsRequire } from "tsx/cjs/api";
import type { GscReport, GscRow, SearchConsoleFilters } from "../packages/lib/src/search-console";
import { testDatabaseUrl } from "./test-database";

const { defaultSearchConsoleDates, getAiQuestionSignals, GSC_FILTER_VERSION, reportFiltersSchema } = tsRequire(
	"../packages/lib/src/search-console/index.ts",
	import.meta.url,
) as typeof import("../packages/lib/src/search-console");

export const GSC_BRAND_ID = "gsc-e2e";
export const GSC_PROPERTY = "https://example.com/";
export const GSC_DATES = defaultSearchConsoleDates();
export const GSC_BEST_QUESTION = "未経験ですが週3日で働く方法を教えてください";
export const GSC_SHORT_REQUEST = "おすすめを教えて";
export const GSC_FOUR_TERMS = "React 副業 週３ リモート";
export const GSC_LONG_QUERY = "フリーランスエンジニア案件求人募集情報一覧";
export const GSC_SHORT_QUESTION = "どうすれば独立できますか";
export const GSC_JOBS_URL = "https://example.com/job_listings/";
export const GSC_JOB_CONDITIONS: SearchConsoleFilters["urlConditions"] = [{ operator: "subtree", value: GSC_JOBS_URL }];
export const GSC_ACTIVE_JOB_CONDITIONS: SearchConsoleFilters["urlConditions"] = [
	...GSC_JOB_CONDITIONS,
	{ operator: "notContains", value: "/archive/" },
];

type PageRow = GscRow & { pageUrl: string };
const row = (query: string, impressions: number, path: string): PageRow => ({
	query,
	impressions,
	clicks: 10,
	ctr: 10 / impressions,
	position: 5.2,
	pageUrl: new URL(path, GSC_PROPERTY).href,
});
const pageRows: PageRow[] = [
	...Array.from({ length: 119 }, (_, index) =>
		row(`一般検索語${String(index + 1).padStart(3, "0")}`, 20000 - index, `/blog/topic-${index + 1}/`),
	),
	row(GSC_LONG_QUERY, 18000, "/blog/list/"),
	row(GSC_BEST_QUESTION, 1000, "/job_listings/engineer/"),
	row(GSC_SHORT_REQUEST, 900, "/job_listings/designer/"),
	row(GSC_SHORT_QUESTION, 800, "/job_listings/"),
	row(GSC_FOUR_TERMS, 700, "/job_listings/archive/old/"),
	row("=SUM(1,2)", 600, "/blog/export/"),
];

function matchesUrl(pageUrl: string, condition: SearchConsoleFilters["urlConditions"][number]): boolean {
	switch (condition.operator) {
		case "contains":
			return pageUrl.includes(condition.value);
		case "notContains":
			return !pageUrl.includes(condition.value);
		case "equals":
			return pageUrl === condition.value;
		case "subtree": {
			const prefix = condition.value.replace(/\/+$/, "");
			return pageUrl === prefix || pageUrl.startsWith(`${prefix}/`);
		}
	}
}

function report(filters: SearchConsoleFilters): GscReport {
	const rows = pageRows
		.filter(
			(item) =>
				(!filters.keyword || item.query.includes(filters.keyword)) &&
				(!filters.aiQuestionsOnly || getAiQuestionSignals(item.query).reasons.length > 0) &&
				filters.urlConditions.every((condition) => matchesUrl(item.pageUrl, condition)),
		)
		.map(({ pageUrl: _pageUrl, ...item }) => item);
	const clicks = rows.reduce((sum, item) => sum + item.clicks, 0);
	const impressions = rows.reduce((sum, item) => sum + item.impressions, 0);
	return {
		rows,
		totals: { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: rows.length ? 5.2 : 0 },
		fetchedAt: new Date().toISOString(),
		truncated: false,
	};
}

export async function seedSearchConsoleFixtures() {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test"))
		throw new Error("Search Console fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		await client.query("BEGIN");
		await client.query("DELETE FROM brands WHERE id = $1", [GSC_BRAND_ID]);
		await client.query(
			`INSERT INTO organization(id,name,slug,created_at) VALUES($1,'Search Console E2E',$1,NOW()) ON CONFLICT(id) DO NOTHING`,
			[GSC_BRAND_ID],
		);
		await client.query(`INSERT INTO brands(id,name,website,onboarded) VALUES($1,'Search Console E2E',$2,false)`, [
			GSC_BRAND_ID,
			GSC_PROPERTY,
		]);
		const revision = randomUUID();
		await client.query(
			`INSERT INTO gsc_connections(brand_id,refresh_token_ciphertext,connected_by,property_id,revision) VALUES($1,'fixture-cache-only-never-used','fixture',$2,$3)`,
			[GSC_BRAND_ID, GSC_PROPERTY, revision],
		);
		const scopes: SearchConsoleFilters["urlConditions"][] = [
			[],
			[{ operator: "contains", value: "/job_listings/" }],
			GSC_JOB_CONDITIONS,
			GSC_ACTIVE_JOB_CONDITIONS,
			[{ operator: "equals", value: `${GSC_JOBS_URL}engineer/` }],
		];
		for (const urlConditions of scopes)
			for (const aiQuestionsOnly of [false, true])
				for (const keyword of ["", "独立"]) {
					const filters = reportFiltersSchema.parse({ ...GSC_DATES, keyword, aiQuestionsOnly, urlConditions });
					// Mirror the small serialization contract in searchConsoleCacheKey. Importing
					// its runtime would initialize DB/auth/request-context modules in Playwright.
					// The shared version and real UI cache hit make any contract drift fail closed:
					// this deliberately unusable token can never refresh a missed fixture.
					const key = createHash("sha256")
						.update(
							JSON.stringify({
								version: GSC_FILTER_VERSION,
								brandId: GSC_BRAND_ID,
								revision,
								propertyId: GSC_PROPERTY,
								hosts: ["example.com"],
								filters,
							}),
						)
						.digest("hex");
					await client.query(
						`INSERT INTO gsc_query_cache(cache_key,brand_id,connection_revision,payload,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '6 hours')`,
						[key, GSC_BRAND_ID, revision, JSON.stringify(report(filters))],
					);
				}
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		await client.end();
	}
}
