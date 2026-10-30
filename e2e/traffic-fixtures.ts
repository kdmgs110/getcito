/** Cached reports exercise the real authenticated UI without contacting Google. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { require as tsRequire } from "tsx/cjs/api";
import { testDatabaseUrl } from "./test-database";

// The web server is ESM while the shared source package is consumed as CJS by Node.
// Load through tsx so this fixture uses exactly the production cache-key function.
const { trafficCacheKey } = tsRequire(
	"../apps/web/src/server/traffic-security.ts",
	import.meta.url,
) as typeof import("../apps/web/src/server/traffic-security");

export const TRAFFIC_BRAND_ID = "traffic-e2e";
export const TRAFFIC_FROM = "2026-10-02";
export const TRAFFIC_TO = "2026-10-29";
export const TRAFFIC_ROOT_VIEW = "00000000-0000-0000-0000-410000000001";
export const TRAFFIC_JOBS_VIEW = "00000000-0000-0000-0000-410000000002";
export const TRAFFIC_HOST = "example.com";

type Condition = { mode: "include" | "exclude"; operator: "exact" | "subtree" | "contains" | "regex"; value: string };
const rootConditions: Condition[] = [{ mode: "include", operator: "exact", value: "/" }];
const jobConditions: Condition[] = [{ mode: "include", operator: "subtree", value: "/job_listings" }];
const dates = Array.from({ length: 28 }, (_, i) => new Date(Date.UTC(2026, 9, i + 2)).toISOString().slice(0, 10));
const counts = (ai: number, total: number, chatgpt = 0, perplexity = 0, gemini = 0, claude = 0) => ({
	ai,
	total,
	chatgpt,
	perplexity,
	gemini,
	claude,
	copilot: 0,
	other: 0,
});
const pages = [
	{ path: "/", daily: counts(4, 40, 3, 1) },
	{ path: "/job_listings/engineer/", daily: counts(3, 30, 2, 0, 1) },
	{ path: "/job_listings/", daily: counts(2, 20, 1, 1) },
	{ path: "/job_listings/marketing/", daily: counts(1, 10, 0, 0, 0, 1) },
];
const sum = (daily: ReturnType<typeof counts>) =>
	Object.fromEntries(Object.entries(daily).map(([k, v]) => [k, v * 28]));

export async function seedTrafficFixtures() {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Traffic fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		await client.query("DELETE FROM brands WHERE id = $1", [TRAFFIC_BRAND_ID]);
		await client.query(
			`INSERT INTO organization(id,name,slug,created_at) VALUES($1,'Traffic E2E',$1,NOW()) ON CONFLICT(id) DO NOTHING`,
			[TRAFFIC_BRAND_ID],
		);
		await client.query(
			`INSERT INTO brands(id,name,website,onboarded) VALUES($1,'Traffic E2E','https://example.com',false)`,
			[TRAFFIC_BRAND_ID],
		);
		const revision = randomUUID();
		await client.query(
			`INSERT INTO ga4_connections(brand_id,refresh_token_ciphertext,connected_by,property_id,property_name,hostname,time_zone,revision)
			VALUES($1,'fixture-cache-only-never-used','fixture','123456','E2E Analytics','example.com','Asia/Tokyo',$2)`,
			[TRAFFIC_BRAND_ID, revision],
		);
		for (const [id, name, conditions, order] of [
			[TRAFFIC_ROOT_VIEW, "トップページ", rootConditions, 0],
			[TRAFFIC_JOBS_VIEW, "求人一覧配下", jobConditions, 1],
		] as const) {
			await client.query(
				`INSERT INTO traffic_saved_views(id,brand_id,hostname,name,normalized_name,conditions,sort_order,created_by,updated_by)
				VALUES($1,$2,'example.com',$3,$3,$4,$5,'fixture','fixture')`,
				[id, TRAFFIC_BRAND_ID, name, JSON.stringify(conditions), order],
			);
		}
		const connection = {
			brandId: TRAFFIC_BRAND_ID,
			revision,
			propertyId: "123456",
			hostname: TRAFFIC_HOST,
			measurementMode: "landing_sessions" as const,
		};
		const fetchedAt = new Date().toISOString();
		async function cache(kind: "overview" | "pages" | "detail", input: unknown, payload: unknown) {
			const key = trafficCacheKey(kind, connection, input);
			await client.query(
				`INSERT INTO traffic_query_cache(cache_key,brand_id,connection_revision,payload,expires_at)
				VALUES($1,$2,$3,$4,NOW()+INTERVAL '6 hours') ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at`,
				[key, TRAFFIC_BRAND_ID, revision, JSON.stringify(payload)],
			);
		}
		const scopes: { conditions: Condition[]; selected: typeof pages }[] = [
			{ conditions: [], selected: pages },
			{ conditions: rootConditions, selected: [pages[0]] },
			{ conditions: jobConditions, selected: pages.slice(1) },
			{ conditions: [{ mode: "include", operator: "contains", value: "/engineer" }], selected: [pages[1]] },
			{
				conditions: [{ mode: "include", operator: "regex", value: "/job_listings/(engineer|marketing)/" }],
				selected: [pages[1], pages[3]],
			},
			{
				conditions: [...jobConditions, { mode: "exclude", operator: "exact", value: "/job_listings/engineer/" }],
				selected: [pages[2], pages[3]],
			},
		];
		for (const { conditions, selected } of scopes) {
			const daily = selected.reduce(
				(a, p) =>
					Object.fromEntries(
						Object.keys(a).map((key) => [key, a[key as keyof typeof a] + p.daily[key as keyof typeof a]]),
					) as ReturnType<typeof counts>,
				counts(0, 0),
			);
			const input = { brandId: TRAFFIC_BRAND_ID, from: TRAFFIC_FROM, to: TRAFFIC_TO, conditions };
			await cache("overview", input, {
				points: dates.map((date) => ({ date, ...daily })),
				totals: sum(daily),
				warnings: [],
				timeZone: "Asia/Tokyo",
				fetchedAt,
			});
			for (const pageSize of [5, 10, 25, 50])
				for (const pageScope of ["ai", "all"])
					for (const pageSearch of ["", "engineer", "missing-path"]) {
						const matches = selected.filter((p) => p.path.includes(pageSearch));
						await cache(
							"pages",
							{ ...input, page: 1, pageSize, pageSearch, pageScope },
							{
								rows: matches.map((p) => ({
									path: p.path,
									...sum(p.daily),
									trend: dates.map((date) => ({ date, ...p.daily })),
								})),
								totalRows: matches.length,
								page: 1,
								pageSize,
								warnings: [],
								fetchedAt,
							},
						);
					}
			for (const p of selected)
				await cache(
					"detail",
					{ ...input, path: p.path },
					{
						points: dates.map((date) => ({ date, ...p.daily })),
						totals: sum(p.daily),
						warnings: [],
						timeZone: "Asia/Tokyo",
						fetchedAt,
					},
				);
		}
	} finally {
		await client.end();
	}
}
