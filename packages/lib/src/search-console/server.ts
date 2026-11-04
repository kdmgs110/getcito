import { z } from "zod";
import {
	buildSearchConsoleFilters,
	type GscMetrics,
	type GscReport,
	type GscRow,
	type GscSite,
	propertyMatchesHosts,
	reportFiltersSchema,
	type SearchConsoleFilters,
} from "./index";

const BASE = "https://www.googleapis.com/webmasters/v3/sites";
const PAGE_SIZE = 25_000;
const MAX_ROWS = 50_000;
const metricsSchema = z.object({
	clicks: z.number().finite().nonnegative(),
	impressions: z.number().finite().nonnegative(),
	ctr: z.number().finite().min(0).max(1),
	position: z.number().finite().nonnegative(),
});
const responseSchema = z.object({
	rows: z
		.array(metricsSchema.extend({ keys: z.array(z.string()).optional() }))
		.max(PAGE_SIZE)
		.optional(),
});

export class SearchConsoleError extends Error {
	constructor(
		public readonly code:
			| "GSC_RECONNECT_REQUIRED"
			| "GSC_PROPERTY_FORBIDDEN"
			| "GSC_RATE_LIMITED"
			| "GSC_UNAVAILABLE"
			| "GSC_INVALID_FILTER",
	) {
		super(code);
		this.name = "SearchConsoleError";
	}
}

async function request(accessToken: string, url: string, body?: unknown): Promise<unknown> {
	try {
		const response = await fetch(url, {
			method: body === undefined ? "GET" : "POST",
			headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) {
			if (response.status === 401) throw new SearchConsoleError("GSC_RECONNECT_REQUIRED");
			if (response.status === 429) throw new SearchConsoleError("GSC_RATE_LIMITED");
			if (response.status === 403) {
				const body = (await response.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
				const quota = body?.error?.errors?.some((error) =>
					["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"].includes(
						error.reason ?? "",
					),
				);
				throw new SearchConsoleError(quota ? "GSC_RATE_LIMITED" : "GSC_PROPERTY_FORBIDDEN");
			}
			throw new SearchConsoleError("GSC_UNAVAILABLE");
		}
		return await response.json();
	} catch (error) {
		if (error instanceof SearchConsoleError) throw error;
		throw new SearchConsoleError("GSC_UNAVAILABLE");
	}
}

export async function listSearchConsoleSites(accessToken: string): Promise<GscSite[]> {
	const result = z
		.object({ siteEntry: z.array(z.object({ siteUrl: z.string().max(4096), permissionLevel: z.string() })).optional() })
		.safeParse(await request(accessToken, BASE));
	if (!result.success) throw new SearchConsoleError("GSC_UNAVAILABLE");
	return (result.data.siteEntry ?? []).filter((site) =>
		["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(site.permissionLevel),
	);
}

/** Separate ungrouped totals preserve API aggregation and anonymous-query treatment. */
export async function fetchSearchConsoleReport(
	accessToken: string,
	siteUrl: string,
	allowedHostnames: string[],
	input: SearchConsoleFilters,
): Promise<GscReport> {
	const parsed = reportFiltersSchema.safeParse(input);
	if (!parsed.success) throw new SearchConsoleError("GSC_INVALID_FILTER");
	if (!propertyMatchesHosts(siteUrl, allowedHostnames)) throw new SearchConsoleError("GSC_PROPERTY_FORBIDDEN");
	const filters = buildSearchConsoleFilters(allowedHostnames, parsed.data);
	const base = {
		startDate: parsed.data.startDate,
		endDate: parsed.data.endDate,
		type: "web",
		dataState: "final",
		aggregationType: "auto",
		dimensionFilterGroups: [{ groupType: "and", filters }],
	};
	const url = `${BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
	async function query(dimensions: string[], startRow: number, rowLimit: number) {
		const response = responseSchema.safeParse(
			await request(accessToken, url, { ...base, dimensions, startRow, rowLimit }),
		);
		if (!response.success) throw new SearchConsoleError("GSC_UNAVAILABLE");
		return response.data.rows ?? [];
	}
	const totalRows = await query([], 0, 1);
	const totals: GscMetrics = totalRows[0]
		? {
				clicks: totalRows[0].clicks,
				impressions: totalRows[0].impressions,
				ctr: totalRows[0].ctr,
				position: totalRows[0].position,
			}
		: { clicks: 0, impressions: 0, ctr: 0, position: 0 };
	const rows: GscRow[] = [];
	let truncated = false;
	for (let startRow = 0; startRow < MAX_ROWS; startRow += PAGE_SIZE) {
		const page = await query(["query"], startRow, PAGE_SIZE);
		for (const row of page) {
			if (row.keys?.length !== 1) throw new SearchConsoleError("GSC_UNAVAILABLE");
			rows.push({
				query: row.keys[0],
				clicks: row.clicks,
				impressions: row.impressions,
				ctr: row.ctr,
				position: row.position,
			});
		}
		if (page.length < PAGE_SIZE) break;
		if (rows.length === MAX_ROWS) truncated = (await query(["query"], MAX_ROWS, 1)).length > 0;
	}
	return { rows, totals, fetchedAt: new Date().toISOString(), truncated };
}
