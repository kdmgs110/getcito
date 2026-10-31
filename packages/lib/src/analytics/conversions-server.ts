import { buildAIFilter, classifyAISource } from "./classification";
import type {
	ConversionMetrics,
	ConversionPageRow,
	ConversionPeriod,
	ConversionReport,
	ConversionSourceRow,
	GA4KeyEvent,
} from "./conversion-types";
import { conversionEventNameSchema, emptyConversionMetrics, emptyConversionPeriod } from "./conversions";
import { trafficDates } from "./dates";
import {
	andFilters,
	buildPathFilter,
	type GAFilterExpression,
	normalizeConditions,
	normalizeHostname,
	stringFilter,
	trafficRequestSchema,
} from "./filters";
import { ga4HostnameFilter as hostnameFilter } from "./hostnames-server";
import {
	AnalyticsError,
	type AnalyticsFetchRequest,
	type AnalyticsReportRequest,
	type AnalyticsRow,
	analyticsAllRows,
	analyticsApi,
	analyticsPropertyPath,
	normalizeReportHosts,
	verifyAnalyticsHostRange,
} from "./server";
import { AI_PROVIDERS, type AIProvider, type TrafficGrain } from "./types";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const SOURCES = ["sessionSource", "sessionMedium", "sessionDefaultChannelGroup"];
const MAX_KEY_EVENT_PAGES = 20;

export async function listGA4KeyEvents(accessToken: string, propertyId: string): Promise<GA4KeyEvent[]> {
	const path = analyticsPropertyPath(propertyId);
	const events = new Map<string, GA4KeyEvent>();
	const seen = new Set<string>();
	let pageToken = "";
	for (let page = 0; page < MAX_KEY_EVENT_PAGES; page++) {
		const query = new URLSearchParams({ pageSize: "200", ...(pageToken ? { pageToken } : {}) });
		const result = await analyticsApi<{
			keyEvents?: { name?: string; eventName?: string; createTime?: string; countingMethod?: string }[];
			nextPageToken?: string;
		}>(`${ADMIN_API}/${path}/keyEvents?${query}`, accessToken);
		for (const event of result.keyEvents ?? []) {
			if (
				!event.name?.startsWith(`${path}/keyEvents/`) ||
				!conversionEventNameSchema.safeParse(event.eventName).success
			)
				throw new AnalyticsError("upstream");
			const eventName = event.eventName as string;
			events.set(eventName, {
				name: event.name,
				eventName,
				createTime: event.createTime ?? null,
				countingMethod: event.countingMethod ?? "COUNTING_METHOD_UNSPECIFIED",
			});
		}
		if (!result.nextPageToken) return [...events.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
		if (seen.has(result.nextPageToken)) throw new AnalyticsError("upstream");
		seen.add(result.nextPageToken);
		pageToken = result.nextPageToken;
	}
	throw new AnalyticsError("report_too_large");
}

interface Compatibility {
	dimensionCompatibilities?: { dimensionMetadata?: { apiName?: string }; compatibility?: string }[];
	metricCompatibilities?: { metricMetadata?: { apiName?: string }; compatibility?: string }[];
}
async function compatible(
	input: AnalyticsFetchRequest,
	dimensions: string[],
	metrics: string[],
	filter: GAFilterExpression,
): Promise<boolean> {
	const names = [...new Set(dimensions)];
	try {
		const result = await analyticsApi<Compatibility>(
			`${DATA_API}/${analyticsPropertyPath(input.propertyId)}:checkCompatibility`,
			input.accessToken,
			{
				dimensions: names.map((name) => ({ name })),
				metrics: metrics.map((name) => ({ name })),
				dimensionFilter: filter,
				compatibilityFilter: "COMPATIBLE",
			},
		);
		return (
			names.every((name) =>
				result.dimensionCompatibilities?.some(
					(entry) => entry.dimensionMetadata?.apiName === name && entry.compatibility === "COMPATIBLE",
				),
			) &&
			metrics.every((name) =>
				result.metricCompatibilities?.some(
					(entry) => entry.metricMetadata?.apiName === name && entry.compatibility === "COMPATIBLE",
				),
			)
		);
	} catch (error) {
		if (error instanceof AnalyticsError && error.code === "invalid_request") return false;
		throw error;
	}
}
function value(row: AnalyticsRow, index: number): number {
	const raw = row.metricValues?.[index]?.value;
	if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))
		throw new AnalyticsError("upstream");
	return Number(raw);
}
function dimensions(row: AnalyticsRow): string[] {
	const values = row.dimensionValues?.map((entry) => entry.value) ?? [];
	if (values.some((value) => value === undefined)) throw new AnalyticsError("upstream");
	return values as string[];
}
function periodDimension(grain: TrafficGrain): string {
	return grain === "week" ? "isoYearIsoWeek" : grain === "month" ? "yearMonth" : "date";
}
function bucketDate(date: string, grain: TrafficGrain): string {
	const d = new Date(`${date}T00:00:00Z`);
	if (grain === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	if (grain === "month") d.setUTCDate(1);
	return d.toISOString().slice(0, 10);
}
function reportDate(raw: string, grain: TrafficGrain): string {
	if (grain === "day" && /^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
	if (grain === "month" && /^\d{6}$/.test(raw) && Number(raw.slice(4)) >= 1 && Number(raw.slice(4)) <= 12)
		return `${raw.slice(0, 4)}-${raw.slice(4)}-01`;
	if (grain === "week" && /^\d{6}$/.test(raw)) {
		const week = Number(raw.slice(4));
		if (week < 1 || week > 53) throw new AnalyticsError("upstream");
		const d = new Date(`${raw.slice(0, 4)}-01-04T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * (week - 1));
		return d.toISOString().slice(0, 10);
	}
	throw new AnalyticsError("upstream");
}
function periods(input: AnalyticsFetchRequest, grain: TrafficGrain): Map<string, ConversionPeriod> {
	return new Map(
		trafficDates(input.from, input.to)
			.map((date) => bucketDate(date, grain))
			.map((date) => [date, emptyConversionPeriod(date)]),
	);
}
function initializeSessions(metrics: ConversionMetrics, converted: boolean) {
	metrics.sessions = 0;
	metrics.aiSessions = 0;
	if (converted) {
		metrics.cvSessions = 0;
		metrics.aiCvSessions = 0;
	}
}

export async function fetchConversionReport(
	raw: AnalyticsFetchRequest & {
		eventName: string;
		eventNames?: string[];
		eventScopes?: { hostname: string; eventNames: string[] }[];
		grain: TrafficGrain;
		page?: number;
		pageSize?: number;
		pageSearch?: string;
		detail?: string;
	},
): Promise<ConversionReport> {
	trafficRequestSchema.parse({ ...raw, brandId: "conversions" });
	conversionEventNameSchema.parse(raw.eventName);
	if (raw.eventNames && (raw.eventNames.length === 0 || raw.eventNames.length > 100))
		throw new AnalyticsError("invalid_request");
	const eventNames = [
		...new Set((raw.eventNames ?? [raw.eventName]).map((name) => conversionEventNameSchema.parse(name))),
	].sort();
	if (
		!["day", "week", "month"].includes(raw.grain) ||
		(raw.measurementMode !== undefined && !["landing_sessions", "observed_session_start"].includes(raw.measurementMode))
	)
		throw new AnalyticsError("invalid_request");
	const page = raw.page ?? 1;
	const pageSize = raw.pageSize ?? 10;
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		page > 100000 ||
		![5, 10, 25, 50].includes(pageSize) ||
		(raw.pageSearch?.length ?? 0) > 300
	)
		throw new AnalyticsError("invalid_request");
	const hostnames = normalizeReportHosts(raw);
	const hostname = hostnames[0];
	const conditions = normalizeConditions(raw.conditions, hostnames);
	if (raw.detail)
		conditions.push(...normalizeConditions([{ mode: "include", operator: "exact", value: raw.detail }], hostnames));
	const input = { ...raw, hostname, hostnames, conditions };
	const events = await listGA4KeyEvents(input.accessToken, input.propertyId);
	const selectedEvents = eventNames.map((name) => events.find((event) => event.eventName === name));
	if (selectedEvents.some((event) => !event)) throw new Error("CONVERSION_EVENT_MISSING");
	const warnings = new Set<string>();
	let singleHost = hostnames.length === 1 && input.measurementMode !== "observed_session_start";
	if (singleHost) {
		try {
			await verifyAnalyticsHostRange(input.accessToken, input.propertyId, hostname, input.from, input.to);
		} catch (error) {
			if (error instanceof AnalyticsError && error.code === "unsupported_site") singleHost = false;
			else throw error;
		}
	}
	if (!singleHost) {
		warnings.add("cv_event_host");
		warnings.add("cross_host_landing_unverified");
	}
	const pd = periodDimension(input.grain);
	const hostFilter = andFilters(hostnameFilter(hostnames), stringFilter("platform", "web", "EXACT", false));
	const pathFilter = buildPathFilter(conditions, "landingPage");
	const eventFilter = (names: string[]): GAFilterExpression =>
		names.length === 1
			? stringFilter("eventName", names[0])
			: { filter: { fieldName: "eventName", inListFilter: { values: names, caseSensitive: true } } };
	let cvEventFilter = eventFilter(eventNames);
	if (raw.eventScopes) {
		if (!raw.eventScopes.length || raw.eventScopes.length > 100) throw new AnalyticsError("invalid_request");
		const scopes = raw.eventScopes.map((scope) => {
			const host = normalizeHostname(scope.hostname);
			if (!hostnames.includes(host) || !scope.eventNames.length || scope.eventNames.length > 100)
				throw new AnalyticsError("invalid_request");
			const names = [...new Set(scope.eventNames.map((name) => conversionEventNameSchema.parse(name)))].sort();
			if (names.some((name) => !eventNames.includes(name))) throw new AnalyticsError("invalid_request");
			return { host, names };
		});
		cvEventFilter = {
			orGroup: { expressions: scopes.map(({ host, names }) => andFilters(hostnameFilter([host]), eventFilter(names))) },
		};
	}
	const cvFilter = andFilters(hostFilter, pathFilter, cvEventFilter);
	const required = [pd, ...SOURCES, "hostName", "platform", "eventName"];
	const pageAttributionSupported = await compatible(input, [...required, "landingPage"], ["keyEvents"], cvFilter);
	if (!pageAttributionSupported) {
		warnings.add("conversion_landing_unavailable");
		if (conditions.length || input.detail) throw new AnalyticsError("unsupported_site");
		if (!(await compatible(input, required, ["keyEvents"], cvFilter))) throw new AnalyticsError("invalid_request");
	}
	const countDimensions = [pd, ...SOURCES, ...(pageAttributionSupported ? ["landingPage"] : [])];
	const countRequest: AnalyticsReportRequest = {
		dimensions: countDimensions.map((name) => ({ name })),
		metrics: [{ name: "keyEvents" }],
		dateRanges: [{ startDate: input.from, endDate: input.to }],
		dimensionFilter: cvFilter,
	};
	const counts = await analyticsAllRows(input.accessToken, input.propertyId, countRequest);
	for (const warning of counts.warnings) warnings.add(warning);
	const points = periods(input, input.grain);
	const pageMap = new Map<string, ConversionPageRow>();
	// Keep only populated buckets while aggregating. A wide date range with many
	// landing pages must not allocate every page × date before pagination.
	const pageTrends = new Map<string, Map<string, ConversionPeriod>>();
	const sources: ConversionSourceRow[] = AI_PROVIDERS.map((provider) => ({
		provider,
		sessions: null,
		cv: 0,
		cvSessions: null,
		cvr: null,
	}));
	const sourceMap = new Map(sources.map((source) => [source.provider, source]));
	function sourceFor(provider: AIProvider) {
		const source = sourceMap.get(provider);
		if (!source) throw new AnalyticsError("upstream");
		return source;
	}
	const totals = emptyConversionMetrics();
	function pagePoint(page: ConversionPageRow, date: string): ConversionPeriod {
		let trend = pageTrends.get(page.path);
		if (!trend) {
			trend = new Map();
			pageTrends.set(page.path, trend);
		}
		let point = trend.get(date);
		if (!point) {
			point = emptyConversionPeriod(date);
			if (totals.sessions !== null) initializeSessions(point, totals.cvSessions !== null);
			trend.set(date, point);
			page.trend.push(point);
		}
		return point;
	}
	for (const row of counts.rows) {
		const [date, source, medium, channel, path] = dimensions(row);
		const point = points.get(reportDate(date, input.grain));
		if (!point || dimensions(row).length !== countDimensions.length || (pageAttributionSupported && path === undefined))
			throw new AnalyticsError("upstream");
		const cv = value(row, 0);
		const provider = classifyAISource(source, medium, channel);
		totals.cv += cv;
		point.cv += cv;
		if (provider) {
			totals.aiCv += cv;
			point.aiCv += cv;
			point.providers[provider] += cv;
			sourceFor(provider).cv += cv;
		}
		if (pageAttributionSupported) {
			const pageRow = pageMap.get(path) ?? {
				path,
				...emptyConversionMetrics(),
				trend: [],
			};
			pageRow.cv += cv;
			const trend = pagePoint(pageRow, point.date);
			trend.cv += cv;
			if (provider) {
				pageRow.aiCv += cv;
				trend.aiCv += cv;
				trend.providers[provider] += cv;
			}
			pageMap.set(path, pageRow);
			if (path === "(not set)" || !path.startsWith("/")) warnings.add("conversion_landing_unset");
		}
	}
	const matching = [...pageMap.values()]
		.filter((p) => p.path.toLowerCase().includes((input.pageSearch ?? "").trim().toLowerCase()))
		.sort((a, b) => b.aiCv - a.aiCv || b.cv - a.cv || a.path.localeCompare(b.path));
	const visiblePaths = matching.slice((page - 1) * pageSize, page * pageSize).map((row) => row.path);
	// Host filters describe sessions observed on the selected domains, not
	// necessarily the host where they started. Query both sides with the same
	// host/path/source scope; never sum per-host totals (sessions can overlap).
	const rateFilter = andFilters(hostFilter, pathFilter);
	const convertedFilter = andFilters(cvFilter, stringFilter("isKeyEvent", "true"));
	const sessionDimensions = [
		pd,
		...SOURCES,
		"hostName",
		"platform",
		...(pageAttributionSupported ? ["landingPage"] : []),
	];
	const sessionsSupported = await compatible(input, sessionDimensions, ["sessions"], rateFilter);
	const convertedSupported =
		sessionsSupported &&
		(await compatible(input, [...sessionDimensions, "eventName", "isKeyEvent"], ["sessions"], convertedFilter));
	let cvrSupported = convertedSupported;
	if (!sessionsSupported) warnings.add("cvr_scope_unavailable");
	else if (!convertedSupported) warnings.add("conversion_sessions_unavailable");
	if (sessionsSupported) {
		initializeSessions(totals, convertedSupported);
		for (const point of points.values()) initializeSessions(point, convertedSupported);
		for (const p of pageMap.values()) {
			initializeSessions(p, convertedSupported);
			for (const point of p.trend) initializeSessions(point, convertedSupported);
		}
		for (const source of sources) {
			source.sessions = 0;
			if (convertedSupported) source.cvSessions = 0;
		}
		async function rows(dims: string[], ai: boolean, converted = false) {
			const response = await analyticsAllRows(input.accessToken, input.propertyId, {
				dimensions: dims.map((name) => ({ name })),
				metrics: [{ name: "sessions" }],
				dateRanges: countRequest.dateRanges,
				dimensionFilter: andFilters(
					converted ? convertedFilter : rateFilter,
					ai ? buildAIFilter() : undefined,
					// Only returned pages need per-page denominators. The full-period
					// and period queries above remain unpaginated session unions.
					dims.includes("landingPage")
						? {
								filter: { fieldName: "landingPage", inListFilter: { values: visiblePaths, caseSensitive: true } },
							}
						: undefined,
				),
			});
			for (const warning of response.warnings) warnings.add(warning);
			return response.rows;
		}
		function applyMetrics(target: ConversionMetrics, row: AnalyticsRow, ai: boolean, converted = false) {
			const sessions = value(row, 0);
			if (converted) {
				if (ai) target.aiCvSessions = sessions;
				else target.cvSessions = sessions;
				return;
			}
			if (ai) target.aiSessions = sessions;
			else target.sessions = sessions;
		}
		// Query each requested grain and full-period union directly. Never average daily CVRs.
		for (const converted of [false, ...(convertedSupported ? [true] : [])]) {
			for (const ai of [false, true]) {
				const totalRows = await rows([], ai, converted);
				if (totalRows.length > 1) throw new AnalyticsError("upstream");
				if (totalRows[0]) applyMetrics(totals, totalRows[0], ai, converted);
				for (const row of await rows([pd], ai, converted)) {
					const point = points.get(reportDate(dimensions(row)[0], input.grain));
					if (!point) throw new AnalyticsError("upstream");
					applyMetrics(point, row, ai, converted);
				}
				if (pageAttributionSupported && visiblePaths.length) {
					for (const row of await rows(["landingPage"], ai, converted)) {
						const pageRow = pageMap.get(dimensions(row)[0]);
						if (pageRow) applyMetrics(pageRow, row, ai, converted);
					}
					for (const row of await rows(["landingPage", pd], ai, converted)) {
						const [path, date] = dimensions(row);
						const pageRow = pageMap.get(path);
						if (pageRow) applyMetrics(pagePoint(pageRow, reportDate(date, input.grain)), row, ai, converted);
					}
				}
			}
			for (const row of await rows(SOURCES, true, converted)) {
				const [source, medium, channel] = dimensions(row);
				const provider = classifyAISource(source, medium, channel);
				if (!provider) throw new AnalyticsError("upstream");
				const n = value(row, 0);
				const sourceRow = sourceFor(provider);
				if (converted) sourceRow.cvSessions = (sourceRow.cvSessions ?? 0) + n;
				else sourceRow.sessions = (sourceRow.sessions ?? 0) + n;
			}
		}
	}
	for (const event of selectedEvents)
		if (event?.createTime) {
			const date = new Date(event.createTime);
			if (Number.isFinite(date.getTime())) {
				const created = new Intl.DateTimeFormat("en-CA", {
					timeZone: counts.timeZone,
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
				}).format(date);
				if (input.from < created) warnings.add("conversion_before_registration");
			}
		}
	const allMetrics = [
		totals,
		...points.values(),
		...pageMap.values(),
		...[...pageMap.values()].flatMap((p) => p.trend),
	];
	// Event counts can exceed converting sessions. Use the session union for
	// selected key events, including Japanese names unsupported by rate metrics.
	for (const metrics of allMetrics) {
		metrics.cvr =
			metrics.sessions !== null && metrics.sessions > 0 && metrics.cvSessions !== null
				? metrics.cvSessions / metrics.sessions
				: null;
		metrics.aiCvr =
			metrics.aiSessions !== null && metrics.aiSessions > 0 && metrics.aiCvSessions !== null
				? metrics.aiCvSessions / metrics.aiSessions
				: null;
	}
	for (const source of sources)
		source.cvr =
			source.sessions !== null && source.sessions > 0 && source.cvSessions !== null
				? source.cvSessions / source.sessions
				: null;

	if (
		allMetrics.some(
			(item) =>
				(item.sessions !== null && item.cvSessions !== null && item.cvSessions > item.sessions) ||
				(item.aiSessions !== null && item.aiCvSessions !== null && item.aiCvSessions > item.aiSessions),
		) ||
		sources.some(
			(source) => source.sessions !== null && source.cvSessions !== null && source.cvSessions > source.sessions,
		)
	)
		warnings.add("inconsistent_totals");
	if (
		["data_thresholding", "data_loss_other", "data_sampling", "data_truncated", "inconsistent_totals"].some((warning) =>
			warnings.has(warning),
		)
	) {
		for (const metrics of allMetrics) {
			metrics.cvr = null;
			metrics.aiCvr = null;
		}
		for (const source of sources) source.cvr = null;
		cvrSupported = false;
		warnings.add("conversion_rate_quality_unavailable");
	}

	const pageRows = matching.slice((page - 1) * pageSize, page * pageSize).map((pageRow) => ({
		...pageRow,
		trend: [...points.keys()].map((date) => {
			const existing = pageTrends.get(pageRow.path)?.get(date);
			if (existing) return existing;
			const point = emptyConversionPeriod(date);
			if (totals.sessions !== null) initializeSessions(point, totals.cvSessions !== null);
			return point;
		}),
	}));
	return {
		totals,
		points: [...points.values()],
		sources,
		pages: { rows: pageRows, totalRows: matching.length, page, pageSize },
		measurementScope: singleHost ? "landing_sessions" : "cv_event_host",
		pageAttributionSupported,
		cvrSupported,
		warnings: [...warnings],
		fetchedAt: new Date().toISOString(),
		timeZone: counts.timeZone,
	};
}
