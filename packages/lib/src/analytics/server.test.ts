import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AnalyticsError,
	createAnalyticsOAuthClient,
	fetchTrafficOverview,
	fetchTrafficPages,
	getAnalyticsProperty,
	listAnalyticsProperties,
	listAnalyticsPropertySummaries,
	verifyAnalyticsPropertySite,
} from "./server";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
const input = {
	accessToken: "test-token",
	propertyId: "123",
	hostname: "example.com",
	from: "2026-10-01",
	to: "2026-10-03",
	conditions: [],
};
const row = (values: string[], sessions: number) => ({
	dimensionValues: values.map((value) => ({ value })),
	metricValues: [{ value: String(sessions) }],
});
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function compatibleFields() {
	return {
		dimensionCompatibilities: [
			"landingPage",
			"pagePath",
			"date",
			"sessionSource",
			"sessionMedium",
			"sessionDefaultChannelGroup",
			"hostName",
			"eventName",
			"platform",
		].map((apiName) => ({ dimensionMetadata: { apiName }, compatibility: "COMPATIBLE" })),
		metricCompatibilities: [{ metricMetadata: { apiName: "sessions" }, compatibility: "COMPATIBLE" }],
	};
}
type Request = { dimensions: { name: string }[]; offset?: number; limit?: number; dimensionFilter?: unknown };
function mockReports(handler: (request: Request) => Response) {
	const requests: Request[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, options: RequestInit) => {
			const request = JSON.parse(options.body as string) as Request;
			requests.push(request);
			if (request.dimensions[0].name === "hostName") return json({ rows: [row(["example.com"], 100)], rowCount: 1 });
			return handler(request);
		}),
	);
	return requests;
}

describe("GA4 traffic reports", () => {
	it("joins identical-scope daily totals and AI providers without double counting", async () => {
		const requests = mockReports((request) =>
			request.dimensions.length === 1
				? json({
						rows: [row(["20261001"], 20), row(["20261003"], 10)],
						rowCount: 2,
						metadata: { timeZone: "Asia/Tokyo" },
					})
				: json({
						rows: [
							row(["20261001", "chatgpt.com", "ai-assistant", "AI Assistant"], 5),
							row(["20261001", "new-ai.example", "ai-assistant", "AI Assistant"], 2),
							row(["20261003", "perplexity.ai", "referral", "Referral"], 3),
						],
						rowCount: 3,
					}),
		);
		const result = await fetchTrafficOverview(input);
		expect(result.totals).toMatchObject({ ai: 10, total: 30, chatgpt: 5, perplexity: 3, other: 2 });
		expect(result.points[1]).toMatchObject({ date: "2026-10-02", ai: 0, total: 0 });
		expect(result.timeZone).toBe("Asia/Tokyo");
		expect(requests).toHaveLength(3);
		for (const request of requests.slice(1)) expect(JSON.stringify(request.dimensionFilter)).toContain('"hostName"');
	});
	it("propagates data-quality metadata from either side of the ratio", async () => {
		mockReports((request) =>
			json({
				rows: [],
				rowCount: 0,
				metadata:
					request.dimensions.length === 1
						? { subjectToThresholding: true }
						: { dataLossFromOtherRow: true, samplingMetadatas: [{}] },
			}),
		);
		expect((await fetchTrafficOverview(input)).warnings).toEqual(
			expect.arrayContaining(["data_loss_other", "data_thresholding", "data_sampling"]),
		);
	});
	it("continues pagination before returning a filled series", async () => {
		const requests = mockReports((request) => {
			if (request.dimensions.length === 1) return json({ rows: [row(["20261001"], 10001)], rowCount: 1 });
			return json({
				rows: Array.from({ length: request.offset === 0 ? 10000 : 1 }, () =>
					row(["20261001", "chatgpt.com", "referral", "Referral"], 1),
				),
				rowCount: 10001,
			});
		});
		expect((await fetchTrafficOverview(input)).totals.ai).toBe(10001);
		expect(requests.filter((request) => request.dimensions.length > 1).map((r) => r.offset)).toEqual([0, 10000]);
	});
	it("rejects incomplete pagination rather than reporting partial totals as zero", async () => {
		mockReports((request) =>
			request.dimensions.length === 1 ? json({ rows: [], rowCount: 0 }) : json({ rows: [], rowCount: 10 }),
		);
		await expect(fetchTrafficOverview(input)).rejects.toMatchObject({ code: "upstream" });
	});
	it("ranks complete page metrics before retrieving provider detail", async () => {
		const requests = mockReports((request) => {
			if (request.dimensions.length === 1)
				return json({ rows: [row(["/jobs/a"], 7), row(["/jobs/b"], 5)], rowCount: 20 });
			if (request.dimensions.length === 2)
				return json({ rows: [row(["/jobs/a", "20261001"], 15), row(["/jobs/b", "20261001"], 20)], rowCount: 2 });
			return json({
				rows: [
					row(["/jobs/a", "20261001", "chatgpt.com", "ai-assistant", "AI Assistant"], 7),
					row(["/jobs/b", "20261001", "claude.ai", "referral", "Referral"], 5),
				],
				rowCount: 2,
			});
		});
		const result = await fetchTrafficPages({ ...input, page: 2, pageSize: 5, pageSearch: "/jobs/", pageScope: "ai" });
		expect(result.totalRows).toBe(20);
		expect(result.rows.map(({ path, ai, total }) => ({ path, ai, total }))).toEqual([
			{ path: "/jobs/a", ai: 7, total: 15 },
			{ path: "/jobs/b", ai: 5, total: 20 },
		]);
		expect(requests[1]).toMatchObject({ dimensions: [{ name: "landingPage" }], offset: 5, limit: 5 });
		expect(JSON.stringify(requests[2].dimensionFilter)).toContain('"values":["/jobs/a","/jobs/b"]');
	});
	it("shows a zero-AI page only after supplementary data succeeds", async () => {
		mockReports((request) =>
			request.dimensions.length === 1
				? json({ rows: [row(["/no-ai"], 8)], rowCount: 1 })
				: request.dimensions.length === 2
					? json({ rows: [row(["/no-ai", "20261001"], 8)], rowCount: 1 })
					: json({ rows: [], rowCount: 0 }),
		);
		const result = await fetchTrafficPages({ ...input, page: 1, pageSize: 5, pageSearch: "", pageScope: "all" });
		expect(result.rows[0]).toMatchObject({ path: "/no-ai", total: 8, ai: 0 });
	});
	it("retries a transient property quota response with a bounded delay", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const fetch = vi.fn(async (_url: string, options: RequestInit) => {
			calls++;
			if (calls === 1) return json({}, 429);
			const request = JSON.parse(options.body as string) as Request;
			return request.dimensions[0].name === "hostName"
				? json({ rows: [row(["example.com"], 1)], rowCount: 1 })
				: json({ rows: [], rowCount: 0 });
		});
		vi.stubGlobal("fetch", fetch);
		const result = fetchTrafficOverview(input);
		await vi.runAllTimersAsync();
		expect((await result).totals.ai).toBe(0);
		expect(calls).toBe(4);
	});
	it("does not expose response bodies or tokens on auth failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ secret: "test-token", error: "private-account" }, 401)),
		);
		const error = await fetchTrafficOverview(input).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(AnalyticsError);
		expect(String(error)).toBe("AnalyticsError: Analytics: auth_revoked");
	});
	it("rejects multi-host properties rather than misattributing entry pages", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ rows: [row(["example.com"], 10), row(["other.example.com"], 20)], rowCount: 2 })),
		);
		await expect(fetchTrafficOverview(input)).rejects.toMatchObject({ code: "unsupported_site" });
	});
	it("limits observed-start overview to the selected host and event page for every provider and denominator query", async () => {
		const requests = mockReports((request) =>
			request.dimensions.length === 1
				? json({ rows: [row(["20261001"], 12)], rowCount: 1 })
				: json({ rows: [row(["20261001", "chatgpt.com", "referral", "Referral"], 3)], rowCount: 1 }),
		);
		const result = await fetchTrafficOverview({
			...input,
			measurementMode: "observed_session_start",
			conditions: [{ mode: "include", operator: "exact", value: "/jobs/a" }],
		});
		expect(result.totals).toMatchObject({ total: 12, ai: 3 });
		expect(result.warnings).toContain("observed_session_start");
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			const serialized = JSON.stringify(request);
			expect(serialized).toContain(
				'"fieldName":"eventName","stringFilter":{"matchType":"EXACT","value":"session_start"',
			);
			expect(serialized).toContain('"fieldName":"hostName","stringFilter":{"matchType":"EXACT","value":"example.com"');
			expect(serialized).toContain(
				'"fieldName":"platform","stringFilter":{"matchType":"EXACT","value":"web","caseSensitive":false}',
			);
			expect(serialized).toContain('"fieldName":"pagePath"');
			expect(serialized).not.toContain("landingPage");
		}
	});
	it("uses observed event paths for page search, ranking, enrichment and daily trends", async () => {
		const requests = mockReports((request) =>
			request.dimensions.length === 1
				? json({ rows: [row(["/jobs/a"], 3)], rowCount: 1 })
				: request.dimensions.length === 2
					? json({ rows: [row(["/jobs/a", "20261001"], 12)], rowCount: 1 })
					: json({ rows: [row(["/jobs/a", "20261001", "chatgpt.com", "referral", "Referral"], 3)], rowCount: 1 }),
		);
		const result = await fetchTrafficPages({
			...input,
			measurementMode: "observed_session_start",
			page: 1,
			pageSize: 5,
			pageSearch: "/jobs",
			pageScope: "ai",
		});
		expect(result.rows[0]).toMatchObject({ path: "/jobs/a", ai: 3, total: 12 });
		expect(result.rows[0].trend[0]).toMatchObject({ date: "2026-10-01", ai: 3, total: 12 });
		expect(result.warnings).toContain("observed_session_start");
		expect(requests).toHaveLength(3);
		expect(requests[0].dimensions).toEqual([{ name: "pagePath" }]);
		expect(JSON.stringify(requests[0])).toContain(
			'"fieldName":"pagePath","stringFilter":{"matchType":"CONTAINS","value":"/jobs"',
		);
		for (const request of requests) {
			expect(request.dimensions[0].name).toBe("pagePath");
			expect(JSON.stringify(request)).not.toContain("landingPage");
			expect(JSON.stringify(request.dimensionFilter)).toContain('"value":"session_start"');
			expect(JSON.stringify(request.dimensionFilter)).toContain('"value":"example.com"');
		}
	});
	it("validates properties and paths before sending requests", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(fetchTrafficOverview({ ...input, propertyId: "123/../../other" })).rejects.toMatchObject({
			code: "invalid_request",
		});
		await expect(
			fetchTrafficOverview({
				...input,
				conditions: [{ mode: "include", operator: "exact", value: "https://other.com/jobs" }],
			}),
		).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});
});
describe("GA4 property discovery", () => {
	it.each([
		"landing_sessions",
		"observed_session_start",
	] as const)("fails closed on incomplete or incompatible 200 responses in %s mode", async (mode) => {
		for (const defect of ["missing_dimension", "missing_metric", "incompatible_dimension", "incompatible_metric"]) {
			const metadata = compatibleFields();
			if (defect === "missing_dimension")
				metadata.dimensionCompatibilities = metadata.dimensionCompatibilities.filter(
					(entry) => entry.dimensionMetadata.apiName !== "sessionMedium",
				);
			if (defect === "missing_metric") metadata.metricCompatibilities = [];
			if (defect === "incompatible_dimension") {
				const entry = metadata.dimensionCompatibilities.find(
					(entry) => entry.dimensionMetadata.apiName === "sessionMedium",
				);
				if (entry) entry.compatibility = "INCOMPATIBLE";
			}
			if (defect === "incompatible_metric") metadata.metricCompatibilities[0].compatibility = "INCOMPATIBLE";
			const fetch = vi.fn(async (url: string) => {
				if (url.includes("dataStreams"))
					return json({
						dataStreams: [
							{
								webStreamData: {
									defaultUri: mode === "landing_sessions" ? "https://example.com/" : "https://old.example/",
								},
							},
						],
					});
				if (url.includes(":checkCompatibility")) return json(metadata);
				return json({ timeZone: "Asia/Tokyo" });
			});
			vi.stubGlobal("fetch", fetch);
			await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).rejects.toMatchObject({
				code: "invalid_request",
			});
			expect(fetch.mock.calls.some(([url]) => url.includes(":runReport"))).toBe(false);
		}
	});
	it("checks the report's full dimension combination when binding a property", async () => {
		const fetch = vi.fn(async (url: string) => {
			if (url.includes("dataStreams"))
				return json({ dataStreams: [{ webStreamData: { defaultUri: "https://example.com/" } }] });
			if (url.includes(":checkCompatibility")) return json(compatibleFields());
			if (url.includes(":runReport")) return json({ rows: [row(["example.com"], 100)], rowCount: 1 });
			return json({ timeZone: "Asia/Tokyo" });
		});
		vi.stubGlobal("fetch", fetch);
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).resolves.toBe("landing_sessions");
		expect(fetch.mock.calls.some(([url]) => url.endsWith(":checkCompatibility"))).toBe(true);
	});
	it("bounds token exchange and revocation transport time", () => {
		const client = createAnalyticsOAuthClient({
			clientId: "id",
			clientSecret: "secret",
			redirectUri: "http://localhost/callback",
		});
		expect(client.transporter.defaults).toMatchObject({ timeout: 20_000, retry: false });
	});
	it("paginates accessible properties and includes timezone plus eligible hosts", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("accountSummaries"))
					return json(
						url.includes("pageToken=next")
							? { accountSummaries: [{ propertySummaries: [{ property: "properties/2", displayName: "Two" }] }] }
							: {
									accountSummaries: [{ propertySummaries: [{ property: "properties/1", displayName: "One" }] }],
									nextPageToken: "next",
								},
					);
				if (url.includes("dataStreams"))
					return json({ dataStreams: [{ webStreamData: { defaultUri: "https://example.com/" } }] });
				return json({ timeZone: "Asia/Tokyo" });
			}),
		);
		expect(await listAnalyticsProperties("token")).toEqual([
			{ id: "1", name: "One", timeZone: "Asia/Tokyo", websites: ["example.com"] },
			{ id: "2", name: "Two", timeZone: "Asia/Tokyo", websites: ["example.com"] },
		]);
	});
	it("loads 113 property choices with only the account summary request", async () => {
		const properties = Array.from({ length: 113 }, (_, index) => ({
			property: `properties/${index + 1}`,
			displayName: `Site ${index + 1}`,
		}));
		const fetch = vi.fn(async () => json({ accountSummaries: [{ propertySummaries: properties }] }));
		vi.stubGlobal("fetch", fetch);
		const summaries = await listAnalyticsPropertySummaries("token");
		expect(summaries).toHaveLength(113);
		expect(summaries[112]).toEqual({ id: "113", name: "Site 113" });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]).toEqual([expect.stringContaining("/accountSummaries?"), expect.any(Object)]);
	});
	it("paginates property choices without requesting any per-property metadata", async () => {
		const fetch = vi.fn(async (url: string) =>
			json({
				accountSummaries: [
					{
						propertySummaries: [
							{ property: url.includes("pageToken") ? "properties/2" : "properties/1", displayName: "Site" },
						],
					},
				],
				...(url.includes("pageToken") ? {} : { nextPageToken: "next" }),
			}),
		);
		vi.stubGlobal("fetch", fetch);
		expect(await listAnalyticsPropertySummaries("token")).toEqual([
			{ id: "1", name: "Site" },
			{ id: "2", name: "Site" },
		]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls.every(([url]) => url.includes("/accountSummaries?"))).toBe(true);
	});
	it("loads metadata only for the selected property and preserves Google's access denial", async () => {
		const fetch = vi.fn(async (url: string) =>
			url.includes("dataStreams")
				? json({ dataStreams: [{ webStreamData: { defaultUri: "https://example.com/" } }] })
				: json({ displayName: "Selected", timeZone: "Asia/Tokyo" }),
		);
		vi.stubGlobal("fetch", fetch);
		expect(await getAnalyticsProperty("token", "123")).toEqual({
			id: "123",
			name: "Selected",
			timeZone: "Asia/Tokyo",
			websites: ["example.com"],
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls.every(([url]) => url.includes("/properties/123"))).toBe(true);
		fetch.mockImplementation(async () => json({ error: "private provider details" }, 403));
		await expect(getAnalyticsProperty("token", "456")).rejects.toMatchObject({ code: "forbidden" });
		fetch.mockClear();
		await expect(getAnalyticsProperty("token", "../other")).rejects.toMatchObject({ code: "invalid_request" });
		expect(fetch).not.toHaveBeenCalled();
	});
	it("refuses sites not configured for the selected property", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.includes(":checkCompatibility")
					? json(compatibleFields())
					: json({ dataStreams: [{ webStreamData: { defaultUri: "https://other.com/" } }] }),
			),
		);
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).rejects.toMatchObject({
			code: "site_mismatch",
		});
	});
	it("supports migrated stream URLs only after observing starts on the selected hostname", async () => {
		const fetch = vi.fn(async (url: string) => {
			if (url.includes("dataStreams"))
				return json({ dataStreams: [{ webStreamData: { defaultUri: "https://old.example/" } }] });
			if (url.includes(":checkCompatibility")) return json(compatibleFields());
			if (url.includes(":runReport")) return json({ rows: [row(["example.com"], 10)], rowCount: 1 });
			return json({ timeZone: "Asia/Tokyo" });
		});
		vi.stubGlobal("fetch", fetch);
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).resolves.toBe("observed_session_start");
		const calls = fetch.mock.calls as unknown as [string, RequestInit][];
		const compatibility = calls.find(([url]) => url.includes(":checkCompatibility"));
		expect(JSON.parse(compatibility?.[1].body as string).dimensions).toEqual(
			expect.arrayContaining([
				{ name: "pagePath" },
				{ name: "sessionMedium" },
				{ name: "eventName" },
				{ name: "platform" },
			]),
		);
		const observed = calls.find(([url]) => url.includes(":runReport"));
		expect(JSON.stringify(JSON.parse(observed?.[1].body as string).dimensionFilter)).toContain(
			'"value":"session_start"',
		);
	});
	it("falls back from the strict single-host check only to a verified observed-start boundary", async () => {
		const requests: Request[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, options?: RequestInit) => {
				if (url.includes("dataStreams"))
					return json({ dataStreams: [{ webStreamData: { defaultUri: "https://example.com/" } }] });
				if (url.includes(":checkCompatibility")) return json(compatibleFields());
				if (url.includes(":runReport")) {
					const request = JSON.parse(options?.body as string) as Request;
					requests.push(request);
					return json({
						rows: request.dimensionFilter
							? [row(["example.com"], 8)]
							: [row(["example.com"], 10), row(["other.example"], 3)],
						rowCount: request.dimensionFilter ? 1 : 2,
					});
				}
				return json({ timeZone: "Asia/Tokyo" });
			}),
		);
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).resolves.toBe("observed_session_start");
		expect(requests).toHaveLength(2);
		expect(requests[0].dimensionFilter).toBeUndefined();
		expect(JSON.stringify(requests[1].dimensionFilter)).toContain('"value":"session_start"');
	});
	it("rejects migrated properties with no observed starts, incompatible dimensions, or provider denial", async () => {
		const fetch = vi.fn(async (url: string) => {
			if (url.includes("dataStreams"))
				return json({ dataStreams: [{ webStreamData: { defaultUri: "https://old.example/" } }] });
			if (url.includes(":checkCompatibility")) return json(compatibleFields());
			if (url.includes(":runReport")) return json({ rows: [], rowCount: 0 });
			return json({ timeZone: "Asia/Tokyo" });
		});
		vi.stubGlobal("fetch", fetch);
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).rejects.toMatchObject({
			code: "site_mismatch",
		});
		fetch.mockImplementation(async (url: string) =>
			url.includes(":checkCompatibility")
				? json({}, 400)
				: url.includes("dataStreams")
					? json({ dataStreams: [] })
					: json({ timeZone: "UTC" }),
		);
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).rejects.toMatchObject({
			code: "invalid_request",
		});
		fetch.mockImplementation(async () => json({}, 403));
		await expect(verifyAnalyticsPropertySite("token", "123", "example.com")).rejects.toMatchObject({
			code: "forbidden",
		});
	});
});
