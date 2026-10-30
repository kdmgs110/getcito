import { OAuth2Client } from "google-auth-library";
import { classifyAISource, buildAIFilter } from "./classification";
import { addTrafficTotals, defaultTrafficRange, emptyTrafficTotals, trafficDates } from "./dates";
import {
	andFilters,
	buildPathFilter,
	normalizeConditions,
	normalizeHostname,
	stringFilter,
	trafficPagesRequestSchema,
	trafficRequestSchema,
	trafficPathDimension,
	type GAFilterExpression,
} from "./filters";
import type {
	AnalyticsProperty,
	AnalyticsPropertySummary,
	AnalyticsMeasurementMode,
	TrafficCondition,
	TrafficOverview,
	TrafficPages,
	TrafficPageRow,
	TrafficPoint,
} from "./types";

export function createAnalyticsOAuthClient(options: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}): OAuth2Client {
	return new OAuth2Client({ ...options, transporterOptions: { timeout: 20_000, retry: false } });
}
export type AnalyticsErrorCode =
	| "auth_revoked"
	| "forbidden"
	| "quota"
	| "invalid_request"
	| "unsupported_site"
	| "site_mismatch"
	| "upstream"
	| "report_too_large";
export class AnalyticsError extends Error {
	constructor(public readonly code: AnalyticsErrorCode) {
		super(`Analytics: ${code}`);
		this.name = "AnalyticsError";
	}
}
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const ROW_LIMIT = 10_000;
const MAX_ROWS = 200_000;
interface Row {
	dimensionValues?: { value?: string }[];
	metricValues?: { value?: string }[];
}
interface Report {
	rows?: Row[];
	rowCount?: number;
	metadata?: {
		timeZone?: string;
		dataLossFromOtherRow?: boolean;
		subjectToThresholding?: boolean;
		samplingMetadatas?: unknown[];
		dataTruncationReasons?: unknown[];
	};
}
interface ReportRequest {
	dimensions: { name: string }[];
	metrics: { name: string }[];
	dateRanges: { startDate: string; endDate: string }[];
	dimensionFilter?: GAFilterExpression;
	orderBys?: (
		| { metric: { metricName: string }; desc: boolean }
		| { dimension: { dimensionName: string }; desc: boolean }
	)[];
	limit?: number;
	offset?: number;
}
export interface AnalyticsFetchRequest {
	accessToken: string;
	propertyId: string;
	hostname: string;
	from: string;
	to: string;
	conditions: TrafficCondition[];
	measurementMode?: AnalyticsMeasurementMode;
}

// Quota is shared by all requests for a property in this process. Persistent query
// caching lives in the web service, so this protects only cache-miss bursts.
const propertyQueues = new Map<string, { active: number; waiters: (() => void)[] }>();
async function withPropertySlot<T>(propertyId: string, operation: () => Promise<T>): Promise<T> {
	let queue = propertyQueues.get(propertyId);
	if (!queue) {
		queue = { active: 0, waiters: [] };
		propertyQueues.set(propertyId, queue);
	}
	if (queue.active >= 2) {
		if (queue.waiters.length >= 50) throw new AnalyticsError("quota");
		await new Promise<void>((resolve) => queue.waiters.push(resolve));
	} else queue.active++;
	try {
		return await operation();
	} finally {
		const next = queue.waiters.shift();
		if (next) next();
		else {
			queue.active--;
			if (queue.active === 0) propertyQueues.delete(propertyId);
		}
	}
}
async function api<T>(url: string, accessToken: string, body?: unknown): Promise<T> {
	for (let attempt = 0; attempt < 3; attempt++) {
		let response: Response;
		try {
			response = await fetch(url, {
				method: body ? "POST" : "GET",
				headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
				...(body ? { body: JSON.stringify(body) } : {}),
				signal: AbortSignal.timeout(20_000),
			});
		} catch {
			if (attempt === 2) throw new AnalyticsError("upstream");
			await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
			continue;
		}
		if (response.ok) {
			try {
				return (await response.json()) as T;
			} catch {
				throw new AnalyticsError("upstream");
			}
		}
		if ((response.status === 429 || response.status >= 500) && attempt < 2) {
			await new Promise((r) =>
				setTimeout(
					r,
					Math.min(2000, Math.max(250 * 2 ** attempt, (Number(response.headers.get("retry-after")) || 0) * 1000)),
				),
			);
			continue;
		}
		throw new AnalyticsError(
			response.status === 401
				? "auth_revoked"
				: response.status === 403
					? "forbidden"
					: response.status === 429
						? "quota"
						: response.status === 400
							? "invalid_request"
							: "upstream",
		);
	}
	throw new AnalyticsError("upstream");
}
function propertyPath(propertyId: string): string {
	if (!/^\d+$/.test(propertyId)) throw new AnalyticsError("invalid_request");
	return `properties/${propertyId}`;
}
async function report(accessToken: string, propertyId: string, request: ReportRequest): Promise<Report> {
	return withPropertySlot(propertyId, () =>
		api<Report>(`${DATA_API}/${propertyPath(propertyId)}:runReport`, accessToken, {
			...request,
			returnPropertyQuota: true,
		}),
	);
}
function metadataWarnings(result: Report): string[] {
	const metadata = result.metadata;
	return [
		...(metadata?.dataLossFromOtherRow ? ["data_loss_other"] : []),
		...(metadata?.subjectToThresholding ? ["data_thresholding"] : []),
		...(metadata?.samplingMetadatas?.length ? ["data_sampling"] : []),
		...(metadata?.dataTruncationReasons?.length ? ["data_truncated"] : []),
	];
}
async function allRows(
	accessToken: string,
	propertyId: string,
	request: ReportRequest,
): Promise<{ rows: Row[]; warnings: string[]; timeZone: string }> {
	const rows: Row[] = [];
	const warnings = new Set<string>();
	let timeZone = "UTC";
	for (let offset = 0; offset < MAX_ROWS; offset += ROW_LIMIT) {
		const result = await report(accessToken, propertyId, { ...request, offset, limit: ROW_LIMIT });
		for (const warning of metadataWarnings(result)) warnings.add(warning);
		if (result.metadata?.timeZone) timeZone = result.metadata.timeZone;
		const next = result.rows ?? [];
		rows.push(...next);
		if (rows.length >= (result.rowCount ?? rows.length)) return { rows, warnings: [...warnings], timeZone };
		if (next.length === 0 || next.length > ROW_LIMIT) throw new AnalyticsError("upstream");
	}
	throw new AnalyticsError("report_too_large");
}
function dimensions(row: Row): string[] {
	return row.dimensionValues?.map((v) => v.value ?? "") ?? [];
}
function sessions(row: Row): number {
	const value = row.metricValues?.[0]?.value;
	if (value === undefined || !/^\d+(?:\.\d+)?$/.test(value)) throw new AnalyticsError("upstream");
	return Number(value);
}
function isoDate(value: string): string {
	if (!/^\d{8}$/.test(value)) throw new AnalyticsError("upstream");
	return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
function validateRequest(input: AnalyticsFetchRequest): AnalyticsFetchRequest {
	if (
		input.measurementMode !== undefined &&
		!["landing_sessions", "observed_session_start"].includes(input.measurementMode)
	)
		throw new AnalyticsError("invalid_request");
	trafficRequestSchema.parse({ ...input, brandId: "analytics" });
	propertyPath(input.propertyId);
	const hostname = normalizeHostname(input.hostname);
	return { ...input, hostname, conditions: normalizeConditions(input.conditions, hostname) };
}
function requestBase(
	input: AnalyticsFetchRequest,
	extra?: GAFilterExpression,
): Pick<ReportRequest, "metrics" | "dateRanges" | "dimensionFilter"> {
	return {
		metrics: [{ name: "sessions" }],
		dateRanges: [{ startDate: input.from, endDate: input.to }],
		dimensionFilter: andFilters(
			stringFilter("hostName", input.hostname, "EXACT", false),
			...(input.measurementMode === "observed_session_start"
				? [stringFilter("eventName", "session_start"), stringFilter("platform", "web", "EXACT", false)]
				: []),
			buildPathFilter(input.conditions, trafficPathDimension(input.measurementMode)),
			extra,
		),
	};
}
function dailyPoints(from: string, to: string): Map<string, TrafficPoint> {
	return new Map(trafficDates(from, to).map((date) => [date, { date, ...emptyTrafficTotals() }]));
}

async function verifyHostRange(
	accessToken: string,
	propertyId: string,
	hostname: string,
	from: string,
	to: string,
): Promise<void> {
	const result = await report(accessToken, propertyId, {
		dimensions: [{ name: "hostName" }],
		metrics: [{ name: "sessions" }],
		dateRanges: [{ startDate: from, endDate: to }],
		limit: 100,
	});
	if ((result.rowCount ?? 0) > 100 || metadataWarnings(result).length) throw new AnalyticsError("unsupported_site");
	const hosts = (result.rows ?? []).map((row) => dimensions(row)[0]).filter((h) => h && h !== "(not set)");
	if (hosts.some((h) => h.toLowerCase() !== hostname)) throw new AnalyticsError("unsupported_site");
}

export async function fetchTrafficOverview(raw: AnalyticsFetchRequest): Promise<TrafficOverview> {
	const input = validateRequest(raw);
	if (input.measurementMode !== "observed_session_start")
		await verifyHostRange(input.accessToken, input.propertyId, input.hostname, input.from, input.to);
	const [ai, all] = await Promise.all([
		allRows(input.accessToken, input.propertyId, {
			...requestBase(input, buildAIFilter()),
			dimensions: ["date", "sessionSource", "sessionMedium", "sessionDefaultChannelGroup"].map((name) => ({ name })),
		}),
		allRows(input.accessToken, input.propertyId, { ...requestBase(input), dimensions: [{ name: "date" }] }),
	]);
	const points = dailyPoints(input.from, input.to);
	for (const row of all.rows) {
		const point = points.get(isoDate(dimensions(row)[0]));
		if (!point) throw new AnalyticsError("upstream");
		point.total += sessions(row);
	}
	for (const row of ai.rows) {
		const [date, source, medium, channel] = dimensions(row);
		const point = points.get(isoDate(date));
		const provider = classifyAISource(source, medium, channel);
		if (!point || !provider) throw new AnalyticsError("upstream");
		const count = sessions(row);
		point.ai += count;
		point[provider] += count;
	}
	const totals = emptyTrafficTotals();
	for (const point of points.values()) addTrafficTotals(totals, point);
	const warnings = new Set([...ai.warnings, ...all.warnings]);
	if (input.measurementMode === "observed_session_start") warnings.add("observed_session_start");
	if (totals.ai > totals.total) warnings.add("inconsistent_totals");
	return {
		points: [...points.values()],
		totals,
		warnings: [...warnings],
		fetchedAt: new Date().toISOString(),
		timeZone: all.timeZone,
	};
}

export async function fetchTrafficPages(
	raw: AnalyticsFetchRequest & { page: number; pageSize: number; pageSearch: string; pageScope: "ai" | "all" },
): Promise<TrafficPages> {
	trafficPagesRequestSchema.parse({ ...raw, brandId: "analytics" });
	const input = validateRequest(raw);
	if (input.measurementMode !== "observed_session_start")
		await verifyHostRange(input.accessToken, input.propertyId, input.hostname, input.from, input.to);
	const pathDimension = trafficPathDimension(input.measurementMode);
	const search = raw.pageSearch.trim() ? stringFilter(pathDimension, raw.pageSearch.trim(), "CONTAINS") : undefined;
	const ranked = await report(input.accessToken, input.propertyId, {
		...requestBase(input, raw.pageScope === "ai" ? andFilters(search, buildAIFilter()) : search),
		dimensions: [{ name: pathDimension }],
		orderBys: [
			{ metric: { metricName: "sessions" }, desc: true },
			{ dimension: { dimensionName: pathDimension }, desc: false },
		],
		offset: (raw.page - 1) * raw.pageSize,
		limit: raw.pageSize,
	});
	const paths = (ranked.rows ?? []).map((row) => dimensions(row)[0]);
	const rows: TrafficPageRow[] = paths.map((path) => ({ path, ...emptyTrafficTotals(), trend: [] }));
	const warnings = new Set(metadataWarnings(ranked));
	if (input.measurementMode === "observed_session_start") warnings.add("observed_session_start");
	if (paths.length) {
		const pathSet: GAFilterExpression = {
			filter: { fieldName: pathDimension, inListFilter: { values: paths, caseSensitive: true } },
		};
		const [ai, all] = await Promise.all([
			allRows(input.accessToken, input.propertyId, {
				...requestBase(input, andFilters(pathSet, buildAIFilter())),
				dimensions: [pathDimension, "date", "sessionSource", "sessionMedium", "sessionDefaultChannelGroup"].map(
					(name) => ({ name }),
				),
			}),
			allRows(input.accessToken, input.propertyId, {
				...requestBase(input, pathSet),
				dimensions: [pathDimension, "date"].map((name) => ({ name })),
			}),
		]);
		for (const warning of [...ai.warnings, ...all.warnings]) warnings.add(warning);
		const daily = new Map(paths.map((path) => [path, dailyPoints(input.from, input.to)]));
		for (const row of all.rows) {
			const [path, date] = dimensions(row);
			const point = daily.get(path)?.get(isoDate(date));
			if (!point) throw new AnalyticsError("upstream");
			point.total += sessions(row);
		}
		for (const row of ai.rows) {
			const [path, date, source, medium, channel] = dimensions(row);
			const point = daily.get(path)?.get(isoDate(date));
			const provider = classifyAISource(source, medium, channel);
			if (!point || !provider) throw new AnalyticsError("upstream");
			point.ai += sessions(row);
			point[provider] += sessions(row);
		}
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index];
			row.trend = [...(daily.get(row.path)?.values() ?? [])];
			for (const point of row.trend) addTrafficTotals(row, point);
			// The ranking report's period metric is authoritative for its sort key.
			const rankedCount = sessions(ranked.rows?.[index] as Row);
			if (rankedCount !== (raw.pageScope === "ai" ? row.ai : row.total)) warnings.add("inconsistent_totals");
			if (row.ai > row.total) warnings.add("inconsistent_totals");
		}
	}
	return {
		rows,
		totalRows: ranked.rowCount ?? rows.length,
		page: raw.page,
		pageSize: raw.pageSize,
		warnings: [...warnings],
		fetchedAt: new Date().toISOString(),
	};
}

interface AccountSummaries {
	accountSummaries?: { propertySummaries?: { property: string; displayName: string }[] }[];
	nextPageToken?: string;
}
interface PropertyDetails {
	displayName?: string;
	timeZone?: string;
}
interface DataStreams {
	dataStreams?: { webStreamData?: { defaultUri?: string } }[];
	nextPageToken?: string;
}
async function propertyWebsites(accessToken: string, propertyId: string): Promise<string[]> {
	const sites = new Set<string>();
	let pageToken = "";
	for (let page = 0; page < 20; page++) {
		const query = new URLSearchParams({ pageSize: "200", ...(pageToken ? { pageToken } : {}) });
		const streams = await api<DataStreams>(
			`${ADMIN_API}/${propertyPath(propertyId)}/dataStreams?${query}`,
			accessToken,
		);
		for (const stream of streams.dataStreams ?? []) {
			if (stream.webStreamData?.defaultUri) {
				try {
					sites.add(normalizeHostname(stream.webStreamData.defaultUri));
				} catch {
					/* A malformed stream URI is not an eligible website. */
				}
			}
		}
		if (!streams.nextPageToken) return [...sites];
		pageToken = streams.nextPageToken;
	}
	throw new AnalyticsError("report_too_large");
}
/** Property picker data requires no per-property requests, even for large accounts. */
export async function listAnalyticsPropertySummaries(accessToken: string): Promise<AnalyticsPropertySummary[]> {
	const properties = new Map<string, string>();
	let pageToken = "";
	for (let page = 0; page < 20; page++) {
		const query = new URLSearchParams({ pageSize: "200", ...(pageToken ? { pageToken } : {}) });
		const result = await api<AccountSummaries>(`${ADMIN_API}/accountSummaries?${query}`, accessToken);
		for (const account of result.accountSummaries ?? [])
			for (const property of account.propertySummaries ?? []) {
				const id = property.property.replace(/^properties\//, "");
				propertyPath(id);
				properties.set(id, property.displayName);
			}
		if (!result.nextPageToken) break;
		if (page === 19) throw new AnalyticsError("report_too_large");
		pageToken = result.nextPageToken;
	}
	if (properties.size > 200) throw new AnalyticsError("report_too_large");
	return [...properties].map(([id, name]) => ({ id, name }));
}

/** Google authorizes the selected property directly; no full-account scan is needed. */
export async function getAnalyticsProperty(accessToken: string, propertyId: string): Promise<AnalyticsProperty> {
	const path = propertyPath(propertyId);
	const [details, websites] = await Promise.all([
		api<PropertyDetails>(`${ADMIN_API}/${path}`, accessToken),
		propertyWebsites(accessToken, propertyId),
	]);
	return { id: propertyId, name: details.displayName ?? propertyId, timeZone: details.timeZone ?? "UTC", websites };
}

/** Full metadata API retained for callers that need every property's website details. */
export async function listAnalyticsProperties(accessToken: string): Promise<AnalyticsProperty[]> {
	const entries = await listAnalyticsPropertySummaries(accessToken);
	const output: AnalyticsProperty[] = [];
	// Bound admin requests rather than fetching every property in parallel.
	for (let index = 0; index < entries.length; index += 4) {
		const chunk = await Promise.all(
			entries.slice(index, index + 4).map(async ({ id, name }) => {
				const property = await getAnalyticsProperty(accessToken, id);
				return { ...property, name: property.name === id ? name : property.name };
			}),
		);
		output.push(...chunk);
	}
	return output;
}
export async function verifyAnalyticsPropertySite(
	accessToken: string,
	propertyId: string,
	hostnameInput: string,
): Promise<AnalyticsMeasurementMode> {
	const hostname = normalizeHostname(hostnameInput);
	const websites = await propertyWebsites(accessToken, propertyId);
	const property = await api<PropertyDetails>(`${ADMIN_API}/${propertyPath(propertyId)}`, accessToken);
	const { from, to } = defaultTrafficRange(property.timeZone ?? "UTC");
	if (websites.length === 1 && websites[0] === hostname) {
		try {
			await checkReportCompatibility(accessToken, propertyId, hostname, "landing_sessions");
			await verifyHostRange(accessToken, propertyId, hostname, from, to);
			return "landing_sessions";
		} catch (error) {
			// Only the explicit multi-host/quality guard can trigger this fallback;
			// permission, compatibility, transport and quota failures still surface.
			if (!(error instanceof AnalyticsError) || error.code !== "unsupported_site") throw error;
		}
	}
	// Stream defaultUri is descriptive and can outlive a domain migration. Prove
	// that the chosen host actually has start events; never combine its aliases.
	await checkReportCompatibility(accessToken, propertyId, hostname, "observed_session_start");
	const observed = await report(accessToken, propertyId, {
		dimensions: [{ name: "hostName" }],
		...requestBase({
			accessToken,
			propertyId,
			hostname,
			from,
			to,
			conditions: [],
			measurementMode: "observed_session_start",
		}),
		limit: 2,
	});
	if (metadataWarnings(observed).length || (observed.rowCount ?? 0) > 1) throw new AnalyticsError("unsupported_site");
	if (!(observed.rows ?? []).some((row) => dimensions(row)[0]?.toLowerCase() === hostname && sessions(row) > 0))
		throw new AnalyticsError("site_mismatch");
	return "observed_session_start";
}

async function checkReportCompatibility(
	accessToken: string,
	propertyId: string,
	hostname: string,
	measurementMode: AnalyticsMeasurementMode,
): Promise<void> {
	const dimensions = [
		trafficPathDimension(measurementMode),
		"date",
		"sessionSource",
		"sessionMedium",
		"sessionDefaultChannelGroup",
		"hostName",
		...(measurementMode === "observed_session_start" ? ["eventName", "platform"] : []),
	];
	// Fail closed even on a 200 response: COMPATIBLE filtering can omit fields.
	// Extra compatible fields are allowed, but every requested field is required.
	const result = await api<{
		dimensionCompatibilities?: { dimensionMetadata?: { apiName?: string }; compatibility?: string }[];
		metricCompatibilities?: { metricMetadata?: { apiName?: string }; compatibility?: string }[];
	}>(`${DATA_API}/${propertyPath(propertyId)}:checkCompatibility`, accessToken, {
		dimensions: dimensions.map((name) => ({ name })),
		metrics: [{ name: "sessions" }],
		dimensionFilter: andFilters(
			stringFilter("hostName", hostname, "EXACT", false),
			...(measurementMode === "observed_session_start"
				? [stringFilter("eventName", "session_start"), stringFilter("platform", "web", "EXACT", false)]
				: []),
			buildAIFilter(),
		),
		compatibilityFilter: "COMPATIBLE",
	});
	if (
		!dimensions.every((name) =>
			result.dimensionCompatibilities?.some(
				(entry) => entry.dimensionMetadata?.apiName === name && entry.compatibility === "COMPATIBLE",
			),
		) ||
		!result.metricCompatibilities?.some(
			(entry) => entry.metricMetadata?.apiName === "sessions" && entry.compatibility === "COMPATIBLE",
		)
	)
		throw new AnalyticsError("invalid_request");
}
