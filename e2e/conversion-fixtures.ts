/** Deterministic cached reports; OAuth and Google validation use analytics-preload.mjs. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { require as tsRequire } from "tsx/cjs/api";
import type {
	ConversionMetrics,
	ConversionPeriod,
	ConversionReport,
	TrafficCondition,
	TrafficGrain,
} from "../packages/lib/src/analytics";
import { testDatabaseUrl } from "./test-database";

const { conversionReportCacheKey } = tsRequire(
	"../apps/web/src/server/conversion-cache.ts",
	import.meta.url,
) as typeof import("../apps/web/src/server/conversion-cache");
const { sealAnalyticsSecret } = tsRequire(
	"../apps/web/src/server/traffic-security.ts",
	import.meta.url,
) as typeof import("../apps/web/src/server/traffic-security");
export const CONVERSION_BRAND_ID = "conversion-e2e";
export const CONVERSION_GOAL_ID = "00000000-0000-4000-8000-420000000001";
export const CONVERSION_VIEW_ID = "00000000-0000-4000-8000-420000000002";
export const CONVERSION_FROM = "2026-10-02";
export const CONVERSION_TO = "2026-10-29";
const rootConditions: TrafficCondition[] = [{ mode: "include", operator: "exact", value: "/" }];
const dates = Array.from({ length: 28 }, (_, i) => new Date(Date.UTC(2026, 9, i + 2)).toISOString().slice(0, 10));
const providers = { chatgpt: 3, perplexity: 1, gemini: 0, claude: 0, copilot: 0, other: 0 };
const metrics = (days: number, observed: boolean): ConversionMetrics => ({
	cv: days * 10,
	aiCv: days * 4,
	sessions: observed ? null : days * 100,
	aiSessions: observed ? null : days * 20,
	cvSessions: observed ? null : days * 6,
	aiCvSessions: observed ? null : days * 2,
	cvr: observed ? null : 0.06,
	aiCvr: observed ? null : 0.1,
});
function periods(grain: TrafficGrain, observed: boolean): ConversionPeriod[] {
	const buckets = new Map<string, number>();
	for (const date of dates) {
		const d = new Date(`${date}T00:00:00Z`);
		if (grain === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		if (grain === "month") d.setUTCDate(1);
		const key = d.toISOString().slice(0, 10);
		buckets.set(key, (buckets.get(key) ?? 0) + 1);
	}
	return [...buckets].map(([date, days]) => ({
		date,
		...metrics(days, observed),
		providers: Object.fromEntries(
			Object.entries(providers).map(([key, value]) => [key, value * days]),
		) as typeof providers,
	}));
}

export async function seedConversionFixtures(observed = false) {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Conversion fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		await client.query("DELETE FROM brands WHERE id=$1", [CONVERSION_BRAND_ID]);
		await client.query(
			"INSERT INTO organization(id,name,slug,created_at) VALUES($1,'Conversion E2E',$1,NOW()) ON CONFLICT(id) DO NOTHING",
			[CONVERSION_BRAND_ID],
		);
		await client.query(
			"INSERT INTO brands(id,name,website,onboarded) VALUES($1,'Conversion E2E','https://example.com',false)",
			[CONVERSION_BRAND_ID],
		);
		const revision = randomUUID();
		const measurementMode = observed ? "observed_session_start" : "landing_sessions";
		await client.query(
			`INSERT INTO ga4_connections(brand_id,refresh_token_ciphertext,connected_by,property_id,property_name,hostname,time_zone,revision,measurement_mode) VALUES($1,$2,'fixture','123456','E2E Analytics','example.com','Asia/Tokyo',$3,$4)`,
			[
				CONVERSION_BRAND_ID,
				sealAnalyticsSecret("e2e-cache-refresh", `ga4:refresh:${CONVERSION_BRAND_ID}`),
				revision,
				measurementMode,
			],
		);
		await client.query(
			`INSERT INTO conversion_goals(id,brand_id,property_id,hostname,event_name,display_name,ga4_name,ga4_create_time,counting_method,created_by,updated_by) VALUES($1,$2,'123456','example.com','affiliate_link_click','外部応募クリック','properties/123456/keyEvents/1','2026-01-01','ONCE_PER_EVENT','fixture','fixture')`,
			[CONVERSION_GOAL_ID, CONVERSION_BRAND_ID],
		);
		await client.query(
			`INSERT INTO traffic_saved_views(id,brand_id,hostname,name,normalized_name,conditions,conversion_goal_id,analysis_tab,created_by,updated_by) VALUES($1,$2,'example.com','トップページCV','トップページcv',$3,$4,'conversions','fixture','fixture')`,
			[CONVERSION_VIEW_ID, CONVERSION_BRAND_ID, JSON.stringify(rootConditions), CONVERSION_GOAL_ID],
		);
		const connection = {
			brandId: CONVERSION_BRAND_ID,
			revision,
			propertyId: "123456",
			hostname: "example.com",
			measurementMode,
		} as const;
		for (const grain of ["day", "week", "month"] as const) {
			const points = periods(grain, observed);
			for (const conditions of [[], rootConditions]) {
				for (const detail of [undefined, "/"]) {
					const input = {
						brandId: CONVERSION_BRAND_ID,
						from: CONVERSION_FROM,
						to: CONVERSION_TO,
						goalId: CONVERSION_GOAL_ID,
						grain,
						conditions,
						...(detail ? { detail } : {}),
					};
					const report: ConversionReport = {
						totals: metrics(28, observed),
						points,
						sources: Object.entries(providers).map(([provider, daily]) => ({
							provider: provider as keyof typeof providers,
							cv: daily * 28,
							sessions: observed ? null : provider === "chatgpt" ? 420 : provider === "perplexity" ? 140 : 0,
							cvSessions: observed ? null : provider === "chatgpt" ? 42 : provider === "perplexity" ? 14 : 0,
							cvr: observed ? null : daily ? 0.1 : 0,
						})),
						pages: {
							rows: [{ path: "/", ...metrics(28, observed), trend: points }],
							totalRows: 1,
							page: 1,
							pageSize: 10,
						},
						measurementScope: observed ? "cv_event_host" : "landing_sessions",
						pageAttributionSupported: true,
						cvrSupported: !observed,
						warnings: observed ? ["cv_event_host", "cross_host_landing_unverified", "cvr_scope_unavailable"] : [],
						fetchedAt: new Date().toISOString(),
						timeZone: "Asia/Tokyo",
					};
					const key = conversionReportCacheKey(connection, { id: CONVERSION_GOAL_ID, revision: 1 }, input);
					await client.query(
						`INSERT INTO traffic_query_cache(cache_key,brand_id,connection_revision,payload,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '6 hours')`,
						[key, CONVERSION_BRAND_ID, revision, JSON.stringify(report)],
					);
				}
			}
		}
	} finally {
		await client.end();
	}
}

export async function readConversionFixtureState() {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Conversion fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		return {
			goals: (
				await client.query(
					"SELECT event_name,display_name,enabled,revision FROM conversion_goals WHERE brand_id=$1 ORDER BY created_at",
					[CONVERSION_BRAND_ID],
				)
			).rows,
			views: (
				await client.query("SELECT name,conditions,analysis_tab,conversion_goal_id FROM traffic_saved_views WHERE brand_id=$1", [
					CONVERSION_BRAND_ID,
				])
			).rows,
		};
	} finally {
		await client.end();
	}
}
