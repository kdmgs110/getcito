import { afterEach, describe, expect, it, vi } from "vitest";
import * as conversionHelpers from "./conversions";
import { conversionRequestSchema } from "./conversions";
import { fetchConversionReport, listGA4KeyEvents } from "./conversions-server";
import type { GAFilterExpression } from "./filters";

const input = {
	accessToken: "token",
	propertyId: "123",
	hostname: "example.com",
	from: "2026-10-01",
	to: "2026-10-03",
	conditions: [],
	eventName: "apply",
	grain: "day" as const,
};
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const row = (dimensions: string[], metrics: number[]) => ({
	dimensionValues: dimensions.map((value) => ({ value })),
	metricValues: metrics.map((value) => ({ value: String(value) })),
});
type Request = {
	dimensions: { name: string }[];
	metrics: { name: string }[];
	dimensionFilter?: unknown;
	offset?: number;
	limit?: number;
};
const requests: Request[] = [];
function filtered(request: Request, field: string, value?: string): boolean {
	const visit = (node: unknown): boolean => {
		if (!node || typeof node !== "object") return false;
		const object = node as { filter?: { fieldName?: string; stringFilter?: { value?: string } } };
		if (object.filter?.fieldName === field && (value === undefined || object.filter.stringFilter?.value === value))
			return true;
		return Object.values(node).some((value) => (Array.isArray(value) ? value.some(visit) : visit(value)));
	};
	return visit(request.dimensionFilter);
}
function ai(request: Request) {
	return filtered(request, "sessionDefaultChannelGroup");
}
interface MockOptions {
	observed?: boolean;
	rateMetric?: boolean;
	compatible?: (request: Request) => boolean;
	report?: (request: Request) => Response | undefined;
	keyEvents?: unknown[];
}
function mock(options: MockOptions = {}) {
	requests.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes("/keyEvents?"))
				return json({
					keyEvents: options.keyEvents ?? [
						{
							name: "properties/123/keyEvents/1",
							eventName: input.eventName,
							countingMethod: "ONCE_PER_EVENT",
							createTime: "2026-01-01T00:00:00Z",
						},
					],
				});
			if (url.endsWith("/metadata"))
				return json({
					metrics: options.rateMetric === false ? [] : [{ apiName: `sessionKeyEventRate:${input.eventName}` }],
				});
			const request = JSON.parse(init?.body as string) as Request;
			requests.push(request);
			if (url.endsWith(":checkCompatibility")) {
				const allowed = options.compatible?.(request) ?? true;
				return json({
					dimensionCompatibilities: request.dimensions.map(({ name }) => ({
						dimensionMetadata: { apiName: name },
						compatibility: allowed ? "COMPATIBLE" : "INCOMPATIBLE",
					})),
					metricCompatibilities: request.metrics.map(({ name }) => ({
						metricMetadata: { apiName: name },
						compatibility: allowed ? "COMPATIBLE" : "INCOMPATIBLE",
					})),
				});
			}
			if (request.dimensions[0]?.name === "hostName") return json({ rows: [row(["example.com"], [100])], rowCount: 1 });
			const custom = options.report?.(request);
			if (custom) return custom;
			if (request.metrics[0].name === "keyEvents")
				return json({
					rows: [
						row(
							["20261001", "chatgpt.com", "referral", "Referral", "/jobs/1"].slice(0, request.dimensions.length),
							[3],
						),
						row(
							["20261003", "chat.openai.com", "referral", "Referral", "/jobs/2"].slice(0, request.dimensions.length),
							[5],
						),
						row(
							["20261002", "google", "organic", "Organic Search", "/jobs/1"].slice(0, request.dimensions.length),
							[10],
						),
					],
					rowCount: 3,
					metadata: { timeZone: "Asia/Tokyo" },
				});
			const converted = filtered(request, "isKeyEvent");
			const metric = (n: number, _rate: number) => [n];
			if (request.dimensions.length === 0)
				return json({
					rows: [row([], metric(converted ? (ai(request) ? 4 : 10) : ai(request) ? 20 : 100, ai(request) ? 0.2 : 0.1))],
					rowCount: 1,
				});
			if (request.dimensions[0].name === "date")
				return json({
					rows: [
						row(["20261001"], metric(converted ? 1 : 10, 0.1)),
						row(["20261003"], metric(converted ? 3 : 10, 0.3)),
					],
					rowCount: 2,
				});
			if (request.dimensions[0].name === "landingPage")
				return json({
					rows: [
						row(
							request.dimensions.length === 1 ? ["/jobs/1"] : ["/jobs/1", "20261001"],
							metric(converted ? 1 : 10, 0.1),
						),
					],
					rowCount: 1,
				});
			return json({
				rows: [
					row(["chatgpt.com", "referral", "Referral"], metric(converted ? 1 : 10, 0.1)),
					row(["chat.openai.com", "referral", "Referral"], metric(converted ? 3 : 10, 0.3)),
				],
				rowCount: 2,
			});
		}),
	);
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("GA4 conversion reporting", () => {
	it("accepts an all-goals report request while retaining domain selection", () => {
		expect(
			conversionRequestSchema.parse({
				brandId: "brand",
				goalId: "all",
				hostname: "all",
				from: input.from,
				to: input.to,
			}),
		).toMatchObject({ goalId: "all", hostname: "all" });
	});
	it("counts enabled host/event unions and calculates CVR from deduplicated session unions", async () => {
		mock({
			keyEvents: [
				{ name: "properties/123/keyEvents/1", eventName: "apply" },
				{ name: "properties/123/keyEvents/2", eventName: "download" },
			],
			report: (request) =>
				request.metrics[0].name === "keyEvents"
					? json({
							rows: [
								row(["20261001", "chatgpt.com", "referral", "Referral", "/seminar"], [10]),
								row(["20261002", "gemini.google.com", "referral", "Referral", "/contact"], [5]),
							],
							rowCount: 2,
						})
					: undefined,
		});
		const report = await fetchConversionReport({
			...input,
			hostnames: ["example.com", "content.example.com"],
			eventNames: ["apply", "download", "apply"],
			eventScopes: [
				{ hostname: "example.com", eventNames: ["download"] },
				{ hostname: "content.example.com", eventNames: ["apply"] },
			],
		});
		expect(report.totals).toMatchObject({
			aiCv: 15,
			cv: 15,
			aiCvr: 0.2,
			cvr: 0.1,
			sessions: 100,
			aiSessions: 20,
			aiCvSessions: 4,
		});
		expect(report.cvrSupported).toBe(true);
		expect(report.measurementScope).toBe("cv_event_host");
		expect(report.sources.find((source) => source.provider === "chatgpt")?.cv).toBe(10);
		expect(report.sources.find((source) => source.provider === "gemini")?.cv).toBe(5);
		const counts = requests.filter(
			(request) => request.metrics[0].name === "keyEvents" && request.offset !== undefined,
		);
		expect(counts).toHaveLength(1);
		const serialized = JSON.stringify(counts[0].dimensionFilter);
		expect(serialized).toContain(
			'"fieldName":"hostName","inListFilter":{"values":["content.example.com","example.com"]',
		);
		expect(serialized).toContain('"orGroup":{"expressions":[');
		expect(serialized).toContain('"value":"example.com","caseSensitive":false}');
		expect(serialized).toContain('"fieldName":"eventName","stringFilter":{"matchType":"EXACT","value":"download"');
		expect(serialized).toContain('"value":"content.example.com","caseSensitive":false}');
		expect(serialized).toContain('"fieldName":"eventName","stringFilter":{"matchType":"EXACT","value":"apply"');
		expect(
			requests.some((request) => request.metrics.some(({ name }) => name.startsWith("sessionKeyEventRate:"))),
		).toBe(false);
	});
	it("rejects event scopes outside the selected hosts or selected CVs", async () => {
		mock();
		await expect(
			fetchConversionReport({ ...input, eventScopes: [{ hostname: "other.example", eventNames: ["apply"] }] }),
		).rejects.toMatchObject({ code: "invalid_request" });
		await expect(
			fetchConversionReport({ ...input, eventScopes: [{ hostname: "example.com", eventNames: ["download"] }] }),
		).rejects.toMatchObject({ code: "invalid_request" });
		expect(requests.filter((request) => request.metrics[0].name === "keyEvents")).toHaveLength(0);
	});
	it("counts both IDN spellings without admitting other hosts or another host's CV events", async () => {
		const rails = "rails案件.com";
		const sap = "sap案件.com";
		const railsAscii = new URL(`https://${rails}`).hostname;
		const sapAscii = new URL(`https://${sap}`).hostname;
		const events = [
			{ hostName: rails, eventName: "apply", count: 3 },
			{ hostName: railsAscii, eventName: "apply", count: 5 },
			{ hostName: sap, eventName: "download", count: 2 },
			{ hostName: sapAscii, eventName: "download", count: 4 },
			{ hostName: rails, eventName: "download", count: 100 },
			{ hostName: sapAscii, eventName: "apply", count: 100 },
			{ hostName: `sub.${rails}`, eventName: "apply", count: 100 },
			{ hostName: `${rails}.other.example`, eventName: "apply", count: 100 },
			{ hostName: "other.example", eventName: "download", count: 100 },
		];
		function matches(expression: GAFilterExpression, event: (typeof events)[number]): boolean {
			if (expression.andGroup) return expression.andGroup.expressions.every((child) => matches(child, event));
			if (expression.orGroup) return expression.orGroup.expressions.some((child) => matches(child, event));
			const filter = expression.filter;
			if (!filter) throw new Error("Expected a host/event filter");
			const values: Record<string, string> = { hostName: event.hostName, eventName: event.eventName, platform: "web" };
			const value = values[filter.fieldName];
			if (filter.inListFilter) {
				const list = filter.inListFilter;
				return list.values.some((candidate) =>
					list.caseSensitive ? value === candidate : value.toLowerCase() === candidate.toLowerCase(),
				);
			}
			const string = filter.stringFilter;
			if (string?.matchType !== "EXACT") throw new Error("Expected exact matching");
			return string.caseSensitive ? value === string.value : value.toLowerCase() === string.value.toLowerCase();
		}
		mock({
			keyEvents: [
				{ name: "properties/123/keyEvents/1", eventName: "apply" },
				{ name: "properties/123/keyEvents/2", eventName: "download" },
			],
			report: (request) =>
				request.metrics[0].name === "keyEvents"
					? json({
							rows: events
								.filter((event) => matches(request.dimensionFilter as GAFilterExpression, event))
								.map((event) => row(["20261001", "chatgpt.com", "referral", "Referral", "/"], [event.count])),
						})
					: undefined,
		});
		const idnInput = {
			...input,
			hostname: railsAscii,
			hostnames: [railsAscii, sap],
			eventNames: ["apply", "download"],
			eventScopes: [
				{ hostname: rails, eventNames: ["apply"] },
				{ hostname: sapAscii, eventNames: ["download"] },
			],
		};
		expect((await fetchConversionReport(idnInput)).totals).toMatchObject({ cv: 14, aiCv: 14 });
		const counts = requests.find((request) => request.metrics[0].name === "keyEvents" && request.offset === 0);
		const hosts: GAFilterExpression[] = [];
		function collectHostFilters(expression: GAFilterExpression) {
			if (expression.filter?.fieldName === "hostName") hosts.push(expression);
			for (const child of expression.andGroup?.expressions ?? expression.orGroup?.expressions ?? [])
				collectHostFilters(child);
		}
		collectHostFilters(counts?.dimensionFilter as GAFilterExpression);
		expect(hosts).toHaveLength(3);
		expect(
			hosts.map((filter) =>
				[...new Set(events.filter((event) => matches(filter, event)).map((event) => event.hostName))].sort(),
			),
		).toEqual(
			expect.arrayContaining([
				[rails, railsAscii, sap, sapAscii].sort(),
				[rails, railsAscii].sort(),
				[sap, sapAscii].sort(),
			]),
		);
		const countRequests = () => requests.filter((request) => request.metrics[0].name === "keyEvents");
		const before = countRequests().length;
		await expect(
			fetchConversionReport({ ...idnInput, eventScopes: [{ hostname: `sub.${rails}`, eventNames: ["apply"] }] }),
		).rejects.toMatchObject({ code: "invalid_request" });
		expect(countRequests()).toHaveLength(before);
	});
	it("allocates complete trends only for the selected pages in a year-long report", async () => {
		const paths = 500;
		const initialized = vi.spyOn(conversionHelpers, "emptyConversionPeriod");
		mock({
			report: (request) =>
				request.metrics[0].name === "keyEvents"
					? json({
							rows: Array.from({ length: paths }, (_, index) =>
								row(["20261001", "chatgpt.com", "referral", "Referral", `/jobs/${index}`], [1]),
							),
							rowCount: paths,
							metadata: { timeZone: "Asia/Tokyo" },
						})
					: json({ rows: [], rowCount: 0 }),
		});
		const report = await fetchConversionReport({
			...input,
			from: "2026-01-01",
			to: "2026-12-31",
			measurementMode: "observed_session_start",
			page: 2,
			pageSize: 5,
		});
		expect(report.totals).toMatchObject({ cv: paths, aiCv: paths });
		expect(report.pages.totalRows).toBe(paths);
		expect(report.pages.rows).toHaveLength(5);
		for (const page of report.pages.rows) {
			expect(page.trend).toHaveLength(365);
			expect(page.trend.find((point) => point.date === "2026-10-01")).toMatchObject({ cv: 1, aiCv: 1 });
			expect(page.trend.find((point) => point.date === "2026-01-01")).toMatchObject({ cv: 0, aiCv: 0, sessions: 0 });
		}
		const pageSessions = requests.filter(
			(request) =>
				request.metrics[0].name === "sessions" &&
				request.offset !== undefined &&
				request.dimensions.some((d) => d.name === "landingPage"),
		);
		expect(pageSessions.length).toBeGreaterThan(0);
		for (const request of pageSessions) {
			const serialized = JSON.stringify(request.dimensionFilter);
			expect(serialized).toContain(JSON.stringify(report.pages.rows.map((row) => row.path)));
		}
		for (const request of requests.filter(
			(request) => request.metrics[0].name === "sessions" && !request.dimensions.length,
		))
			expect(filtered(request, "landingPage")).toBe(false);
		// One sparse point per populated path, plus the global and five displayed calendars.
		expect(initialized.mock.calls.length).toBeLessThanOrEqual(paths + 6 * 365);
	});
	it("retains session metrics for page buckets without a CV and fills empty days", async () => {
		mock();
		const original = fetch;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				const request = init?.body ? (JSON.parse(init.body as string) as Request) : null;
				if (url.endsWith(":runReport") && request?.dimensions.map((d) => d.name).join(",") === "landingPage,date") {
					const converted = filtered(request, "isKeyEvent");
					return json({ rows: [row(["/jobs/1", "20261003"], converted ? [1] : [5, 0.4])], rowCount: 1 });
				}
				return original(url, init);
			}),
		);
		const report = await fetchConversionReport(input);
		const page = report.pages.rows.find((page) => page.path === "/jobs/1");
		expect(page?.trend.map((point) => point.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
		expect(page?.trend[2]).toMatchObject({
			cv: 0,
			aiCv: 0,
			sessions: 5,
			aiSessions: 5,
			cvSessions: 1,
			aiCvSessions: 1,
			cvr: 0.2,
			aiCvr: 0.2,
		});
	});

	it("accepts Japanese event names from GA4 and schema defaults", async () => {
		mock({ keyEvents: [{ name: "properties/123/keyEvents/1", eventName: "応募完了" }] });
		expect((await listGA4KeyEvents("token", "123"))[0].eventName).toBe("応募完了");
		expect(
			conversionRequestSchema.parse({
				brandId: "brand",
				goalId: "11111111-1111-4111-8111-111111111111",
				from: input.from,
				to: input.to,
			}),
		).toMatchObject({ grain: "day", page: 1, pageSize: 10, conditions: [] });
	});
	it("separates repeated CV counts, converted sessions, and true session rates", async () => {
		mock();
		const report = await fetchConversionReport(input);
		expect(report.totals).toMatchObject({
			cv: 18,
			aiCv: 8,
			sessions: 100,
			aiSessions: 20,
			cvSessions: 10,
			aiCvSessions: 4,
			cvr: 0.1,
			aiCvr: 0.2,
		});
		expect(report.sources.find((source) => source.provider === "chatgpt")).toMatchObject({
			cv: 8,
			sessions: 20,
			cvSessions: 4,
			cvr: 0.2,
		});
		expect(report.totals.aiCvr).not.toBe(8 / 20);
		expect(report.pages.rows.map((p) => p.path)).toEqual(["/jobs/2", "/jobs/1"]);
		const rates = requests.filter((r) => r.metrics[0].name === "sessions" && !filtered(r, "isKeyEvent"));
		expect(rates.length).toBeGreaterThan(0);
		for (const request of rates) {
			expect(filtered(request, "eventName")).toBe(false);
			expect(filtered(request, "isKeyEvent")).toBe(false);
		}
		const counts = requests.filter((r) => r.metrics[0].name === "keyEvents");
		expect(counts.every((r) => filtered(r, "eventName", "apply") && !filtered(r, "eventName", "session_start"))).toBe(
			true,
		);
	});
	it("uses matching domain/path filters for sessions and converting sessions in observed mode", async () => {
		mock();
		const report = await fetchConversionReport({
			...input,
			measurementMode: "observed_session_start",
			conditions: [{ mode: "include", operator: "contains", value: "/jobs" }],
		});
		expect(report.measurementScope).toBe("cv_event_host");
		expect(report.totals).toMatchObject({
			cv: 18,
			aiCv: 8,
			sessions: 100,
			aiSessions: 20,
			cvr: 0.1,
			aiCvr: 0.2,
			cvSessions: 10,
		});
		expect(report.warnings).toEqual(expect.arrayContaining(["cross_host_landing_unverified"]));
		expect(report.pageAttributionSupported).toBe(true);
		expect(report.cvrSupported).toBe(true);
		expect(
			requests
				.filter((r) => r.metrics[0].name === "sessions")
				.every((r) => filtered(r, "hostName") && filtered(r, "platform", "web") && filtered(r, "landingPage")),
		).toBe(true);
		expect(requests.some((r) => r.metrics.some((m) => m.name.startsWith("sessionKeyEventRate:")))).toBe(false);
		expect(
			requests
				.filter((r) => r.metrics[0].name === "keyEvents")
				.every((r) => JSON.stringify(r.dimensionFilter).includes('"landingPage"')),
		).toBe(true);
	});
	it("downgrades a newly multi-host property rather than combining incompatible denominators", async () => {
		mock({ report: () => json({ rows: [], rowCount: 0 }) });
		const original = fetch;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				const r = init?.body ? JSON.parse(init.body as string) : null;
				if (url.endsWith(":runReport") && r.dimensions[0]?.name === "hostName")
					return json({ rows: [row(["example.com"], [100]), row(["another.example"], [100])], rowCount: 2 });
				return original(url, init);
			}),
		);
		expect((await fetchConversionReport(input)).measurementScope).toBe("cv_event_host");
	});
	it("uses GA4 week/month buckets and direct period totals, not daily-rate means", async () => {
		for (const grain of ["week", "month"] as const) {
			const dim = grain === "week" ? "isoYearIsoWeek" : "yearMonth";
			const key = grain === "week" ? "202640" : "202610";
			mock({
				report: (request) => {
					if (request.metrics[0].name === "keyEvents")
						return json({ rows: [row([key, "chatgpt.com", "referral", "Referral", "/jobs/1"], [3])], rowCount: 1 });
					const values = request.dimensions.map(({ name }) =>
						name === dim
							? key
							: name === "landingPage"
								? "/jobs/1"
								: name === "sessionSource"
									? "chatgpt.com"
									: name === "sessionMedium"
										? "referral"
										: "Referral",
					);
					return json({ rows: [row(values, filtered(request, "isKeyEvent") ? [1] : [10, 0.1])], rowCount: 1 });
				},
			});
			const report = await fetchConversionReport({ ...input, grain });
			expect(report.points).toHaveLength(1);
			expect(report.points[0]).toMatchObject({
				date: grain === "week" ? "2026-09-28" : "2026-10-01",
				aiCv: 3,
				aiCvr: 0.1,
			});
			expect(requests.filter((r) => r.metrics[0].name === "sessions").some((r) => r.dimensions.length === 0)).toBe(
				true,
			);
			expect(requests.every((r) => !r.dimensions.some((d) => d.name === "date"))).toBe(true);
		}
	});
	it("does not depend on an event-specific CVR metric for Japanese key events", async () => {
		mock({ rateMetric: false, keyEvents: [{ name: "properties/123/keyEvents/1", eventName: "webセミナー申し込み" }] });
		const report = await fetchConversionReport({
			...input,
			eventName: "webセミナー申し込み",
			measurementMode: "observed_session_start",
		});
		expect(report.cvrSupported).toBe(true);
		expect(report.totals).toMatchObject({ aiCv: 8, aiSessions: 20, aiCvSessions: 4, aiCvr: 0.2 });
		expect(requests.some((r) => r.metrics.some((m) => m.name.startsWith("sessionKeyEventRate:")))).toBe(false);
	});
	it("preserves denominators if converted-session dimensions are unavailable", async () => {
		mock({ compatible: (r) => !filtered(r, "isKeyEvent") });
		const report = await fetchConversionReport(input);
		expect(report.totals).toMatchObject({ aiCv: 8, aiSessions: 20, aiCvSessions: null, aiCvr: null });
		expect(report.cvrSupported).toBe(false);
		expect(report.warnings).toContain("conversion_sessions_unavailable");
	});
	it("leaves sessions unavailable when GA4 cannot support matching dimensions", async () => {
		mock({ compatible: (r) => r.metrics[0].name !== "sessions" });
		const report = await fetchConversionReport(input);
		expect(report.totals).toMatchObject({ aiCv: 8, aiSessions: null, aiCvSessions: null, aiCvr: null });
		expect(report.cvrSupported).toBe(false);
	});
	it("suppresses impossible rates when converting sessions exceed the denominator", async () => {
		mock({
			report: (r) =>
				r.metrics[0].name === "sessions" && !r.dimensions.length
					? json({ rows: [row([], [filtered(r, "isKeyEvent") ? 9 : 5])], rowCount: 1 })
					: undefined,
		});
		const report = await fetchConversionReport(input);
		expect(report.cvrSupported).toBe(false);
		expect(report.totals.aiCvr).toBeNull();
		expect(report.warnings).toContain("inconsistent_totals");
	});

	it("cannot apply a landing-page condition when the required dimension is incompatible", async () => {
		mock({ compatible: (request) => !request.dimensions.some((d) => d.name === "landingPage") });
		await expect(
			fetchConversionReport({ ...input, conditions: [{ mode: "include", operator: "exact", value: "/jobs" }] }),
		).rejects.toMatchObject({ code: "unsupported_site" });
		const report = await fetchConversionReport({ ...input, measurementMode: "observed_session_start" });
		expect(report.pageAttributionSupported).toBe(false);
		expect(report.pages.rows).toEqual([]);
	});
	it("does not present missing GA4 events or upstream errors as zero", async () => {
		mock({ keyEvents: [] });
		await expect(fetchConversionReport(input)).rejects.toThrow("CONVERSION_EVENT_MISSING");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ error: "do not leak" }, 403)),
		);
		await expect(listGA4KeyEvents("token", "123")).rejects.toMatchObject({ code: "forbidden" });
	});
	it("invalidates CVR when a source report is thresholded and preserves the warning", async () => {
		mock({
			report: (request) =>
				request.metrics[0].name === "keyEvents"
					? json({ rows: [], rowCount: 0, metadata: { subjectToThresholding: true } })
					: json({ rows: [], rowCount: 0 }),
		});
		const report = await fetchConversionReport(input);
		expect(report.cvrSupported).toBe(false);
		expect(report.totals.cvr).toBeNull();
		expect(report.warnings).toContain("data_thresholding");
	});
	it("paginates CV rows completely before ranking and supports page search/detail filters", async () => {
		mock({
			report: (request) => {
				if (request.metrics[0].name !== "keyEvents") return json({ rows: [], rowCount: 0 });
				const rows = Array.from({ length: request.offset === 0 ? 10000 : 1 }, () =>
					row(
						["20261001", "new-assistant", "ai-assistant", "AI Assistant", request.offset === 0 ? "/jobs/a" : "/jobs/b"],
						[1],
					),
				);
				return json({ rows, rowCount: 10001 });
			},
		});
		const report = await fetchConversionReport({
			...input,
			measurementMode: "observed_session_start",
			pageSearch: "/jobs/b",
			detail: "/jobs/b",
		});
		expect(report.totals.aiCv).toBe(10001);
		expect(report.sources.find((s) => s.provider === "other")?.cv).toBe(10001);
		expect(report.pages.totalRows).toBe(1);
		expect(
			requests.filter((r) => r.metrics[0].name === "keyEvents" && r.offset !== undefined).map((r) => r.offset),
		).toEqual([0, 10000]);
		expect(
			requests.filter((r) => r.metrics[0].name === "keyEvents").every((r) => filtered(r, "landingPage", "/jobs/b")),
		).toBe(true);
	});
	it("detects incomplete pagination and repeated key-event page tokens", async () => {
		mock({ report: () => json({ rows: [], rowCount: 1 }) });
		await expect(fetchConversionReport({ ...input, measurementMode: "observed_session_start" })).rejects.toMatchObject({
			code: "upstream",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ keyEvents: [], nextPageToken: "repeat" })),
		);
		await expect(listGA4KeyEvents("token", "123")).rejects.toMatchObject({ code: "upstream" });
	});
});
