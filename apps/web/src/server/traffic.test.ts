import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	results: [] as unknown[][],
	writes: [] as unknown[],
	access: vi.fn(),
	connection: vi.fn(),
	token: vi.fn(),
	revision: vi.fn(),
	overview: vi.fn(),
	pages: vi.fn(),
	propertySummaries: vi.fn(),
	property: vi.fn(),
	verifySite: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (data: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@workspace/lib/analytics/server", () => ({
	fetchTrafficOverview: mocks.overview,
	fetchTrafficPages: mocks.pages,
	createAnalyticsOAuthClient: vi.fn(),
	listAnalyticsPropertySummaries: mocks.propertySummaries,
	getAnalyticsProperty: mocks.property,
	verifyAnalyticsPropertySite: mocks.verifySite,
}));
vi.mock("./traffic-oauth", () => ({ startTrafficOAuth: vi.fn() }));
vi.mock("./traffic-runtime", () => ({
	requireTrafficAccess: mocks.access,
	currentTrafficConnection: mocks.connection,
	trafficAccessToken: mocks.token,
	assertTrafficRevision: mocks.revision,
	analyticsConfigured: () => false,
	trafficCanManage: async () => false,
	newTrafficRevision: () => "new-revision",
	analyticsOAuthConfig: vi.fn(),
}));
vi.mock("@workspace/lib/db/db", () => {
	const query = () => {
		const chain = {
			from: () => chain,
			where: () => chain,
			set: (value: unknown) => {
				mocks.writes.push(value);
				return chain;
			},
			values: (value: unknown) => {
				mocks.writes.push(value);
				return chain;
			},
			limit: () => Promise.resolve(mocks.results.shift() ?? []),
			returning: () => Promise.resolve(mocks.results.shift() ?? []),
			onConflictDoUpdate: () => Promise.resolve(),
			// biome-ignore lint/suspicious/noThenProperty: Models an awaitable Drizzle query builder.
			then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve),
		};
		return chain;
	};
	const db = {
		select: query,
		update: query,
		insert: query,
		delete: query,
		transaction: async (operation: (tx: unknown) => unknown) => operation(db),
	};
	return { db };
});

import {
	connectTrafficPropertyFn,
	getAnalyticsPropertiesFn,
	getTrafficConnectionFn,
	getTrafficOverviewFn,
	getTrafficPageDetailFn,
	getTrafficPagesFn,
	trafficProviderError,
} from "./traffic";

const input = { brandId: "brand-a", from: "2026-10-01", to: "2026-10-28", conditions: [] };
const result = {
	points: [],
	totals: { ai: 0, total: 10, chatgpt: 0, perplexity: 0, gemini: 0, claude: 0, copilot: 0, other: 0 },
	warnings: [],
	fetchedAt: "2026-10-29T10:00:00.000Z",
	timeZone: "Asia/Tokyo",
};
const connection = {
	brandId: "brand-a",
	propertyId: "123",
	hostname: "example.com",
	revision: "00000000-0000-4000-8000-000000000001",
	status: "connected",
	measurementMode: "landing_sessions",
	refreshTokenCiphertext: "not-readable-by-client",
};

beforeEach(() => {
	mocks.results.length = 0;
	mocks.writes.length = 0;
	mocks.access.mockReset().mockResolvedValue({ sites: ["example.com"], session: { user: { id: "user-a" } } });
	mocks.connection.mockReset().mockResolvedValue(connection);
	mocks.token.mockReset().mockResolvedValue("private-access-token");
	mocks.revision.mockReset().mockResolvedValue(undefined);
	mocks.overview.mockReset().mockResolvedValue(result);
	mocks.pages.mockReset().mockResolvedValue({ rows: [], warnings: [], fetchedAt: result.fetchedAt });
	mocks.propertySummaries.mockReset().mockResolvedValue([{ id: "123", name: "Selected" }]);
	mocks.property
		.mockReset()
		.mockResolvedValue({ id: "123", name: "Selected", timeZone: "Asia/Tokyo", websites: ["example.com"] });
	mocks.verifySite.mockReset().mockResolvedValue("landing_sessions");
});

describe("GA4 property selection", () => {
	it("returns lightweight choices without loading every property's details", async () => {
		expect(await getAnalyticsPropertiesFn({ data: { brandId: "brand-a" } })).toEqual([{ id: "123", name: "Selected" }]);
		expect(mocks.access).toHaveBeenCalledWith("brand-a", true);
		expect(mocks.propertySummaries).toHaveBeenCalledWith("private-access-token");
		expect(mocks.property).not.toHaveBeenCalled();
	});
	it("connects only the selected property after Google access and hostname validation", async () => {
		mocks.results.push([{ id: "brand-a" }], []);
		await connectTrafficPropertyFn({ data: { brandId: "brand-a", propertyId: "123", hostname: "example.com" } });
		expect(mocks.access).toHaveBeenCalledWith("brand-a", true);
		expect(mocks.property).toHaveBeenCalledWith("private-access-token", "123");
		expect(mocks.propertySummaries).not.toHaveBeenCalled();
		expect(mocks.verifySite).toHaveBeenCalledWith("private-access-token", "123", "example.com");
		expect(mocks.writes).toContainEqual(
			expect.objectContaining({
				propertyId: "123",
				hostname: "example.com",
				timeZone: "Asia/Tokyo",
				revision: "new-revision",
				measurementMode: "landing_sessions",
			}),
		);
	});
	it("persists the verified multi-domain measurement mode", async () => {
		mocks.verifySite.mockResolvedValue("observed_session_start");
		mocks.results.push([{ id: "brand-a" }], []);
		await connectTrafficPropertyFn({ data: { brandId: "brand-a", propertyId: "123", hostname: "example.com" } });
		expect(mocks.writes).toContainEqual(expect.objectContaining({ measurementMode: "observed_session_start" }));
	});
	it("refuses a forged property id when Google denies access, before binding or site verification", async () => {
		mocks.property.mockRejectedValue({ code: "forbidden" });
		await expect(
			connectTrafficPropertyFn({ data: { brandId: "brand-a", propertyId: "456", hostname: "example.com" } }),
		).rejects.toThrow("ANALYTICS_FORBIDDEN");
		expect(mocks.verifySite).not.toHaveBeenCalled();
		expect(mocks.writes).toHaveLength(0);
	});
	it("rejects a selected site outside the brand before contacting Google", async () => {
		await expect(
			connectTrafficPropertyFn({ data: { brandId: "brand-a", propertyId: "123", hostname: "other.com" } }),
		).rejects.toThrow("TRAFFIC_INVALID_SITE");
		expect(mocks.property).not.toHaveBeenCalled();
		expect(mocks.writes).toHaveLength(0);
	});
	it("does not overwrite a changed connection revision", async () => {
		await expect(
			connectTrafficPropertyFn({ data: { brandId: "brand-a", propertyId: "123", hostname: "example.com" } }),
		).rejects.toThrow("ANALYTICS_CONNECTION_CHANGED");
	});
});

describe("GA4 result cache and tenant isolation", () => {
	it("exposes only a safe connection revision that changes even when property and hostname stay the same", async () => {
		const before = await getTrafficConnectionFn({ data: { brandId: "brand-a" } });
		mocks.connection.mockResolvedValue({ ...connection, revision: "00000000-0000-4000-8000-000000000002" });
		const after = await getTrafficConnectionFn({ data: { brandId: "brand-a" } });
		expect(before.propertyId).toBe(after.propertyId);
		expect(before.hostname).toBe(after.hostname);
		expect(before.connectionRevision).not.toBe(after.connectionRevision);
		expect(after).not.toHaveProperty("refreshTokenCiphertext");
	});
	it("returns a null revision when there is no current connection", async () => {
		mocks.connection.mockResolvedValue(undefined);
		const status = await getTrafficConnectionFn({ data: { brandId: "brand-a" } });
		expect(status.connectionRevision).toBeNull();
		expect(status.connected).toBe(false);
		expect(status.measurementMode).toBe("landing_sessions");
	});
	it("returns the persisted measurement mode and defaults legacy connections to landing sessions", async () => {
		mocks.connection.mockResolvedValue({ ...connection, measurementMode: "observed_session_start" });
		expect((await getTrafficConnectionFn({ data: { brandId: "brand-a" } })).measurementMode).toBe(
			"observed_session_start",
		);
		mocks.connection.mockResolvedValue({ ...connection, measurementMode: undefined });
		expect((await getTrafficConnectionFn({ data: { brandId: "brand-a" } })).measurementMode).toBe("landing_sessions");
	});
	it("uses the stored mode for overview, page list and detail requests", async () => {
		mocks.connection.mockResolvedValue({ ...connection, measurementMode: "observed_session_start" });
		await getTrafficOverviewFn({ data: input });
		await getTrafficPagesFn({ data: { ...input, page: 1, pageSize: 10, pageScope: "ai", pageSearch: "" } });
		await getTrafficPageDetailFn({ data: { ...input, path: "/jobs" } });
		expect(mocks.overview).toHaveBeenCalledTimes(2);
		for (const [request] of mocks.overview.mock.calls) expect(request.measurementMode).toBe("observed_session_start");
		expect(mocks.pages).toHaveBeenCalledWith(expect.objectContaining({ measurementMode: "observed_session_start" }));
	});
	it("uses landing sessions when a legacy connection has no persisted mode", async () => {
		mocks.connection.mockResolvedValue({ ...connection, measurementMode: undefined });
		await getTrafficOverviewFn({ data: input });
		expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ measurementMode: "landing_sessions" }));
	});
	it("ignores a caller's attempt to override the connection measurement mode", async () => {
		const forged = { ...input, measurementMode: "observed_session_start" };
		await getTrafficOverviewFn({ data: forged });
		expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ measurementMode: "landing_sessions" }));
	});
	it("returns a fresh cache hit before refreshing any Google token", async () => {
		mocks.results.push([{ payload: result, expiresAt: new Date(Date.now() + 60_000) }]);
		expect(await getTrafficOverviewFn({ data: input })).toEqual(result);
		expect(mocks.token).not.toHaveBeenCalled();
		expect(mocks.overview).not.toHaveBeenCalled();
		expect(mocks.revision).toHaveBeenCalledWith("brand-a", connection.revision);
	});
	it("requires brand access before cache lookup or provider requests", async () => {
		mocks.access.mockRejectedValue(new Error("Forbidden"));
		await expect(getTrafficOverviewFn({ data: input })).rejects.toThrow("Forbidden");
		expect(mocks.connection).not.toHaveBeenCalled();
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("deduplicates concurrent requests with the same actual scope", async () => {
		let release: (value: typeof result) => void = () => {};
		mocks.overview.mockImplementation(
			() =>
				new Promise<typeof result>((resolve) => {
					release = resolve;
				}),
		);
		mocks.results.push([], []);
		const first = getTrafficOverviewFn({ data: input });
		const second = getTrafficOverviewFn({ data: input });
		await vi.waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));
		release(result);
		expect(await Promise.all([first, second])).toEqual([result, result]);
		expect(mocks.token).toHaveBeenCalledTimes(1);
	});
	it("rejects a result if the connection changes while it is being fetched", async () => {
		mocks.results.push([]);
		mocks.revision.mockRejectedValue(new Error("ANALYTICS_CONNECTION_CHANGED"));
		await expect(getTrafficOverviewFn({ data: input })).rejects.toThrow("ANALYTICS_CONNECTION_CHANGED");
		expect(mocks.writes).toHaveLength(0);
	});
	it("retains the last successful result with an explicit stale warning during quota failure", async () => {
		mocks.results.push([{ payload: result, expiresAt: new Date(Date.now() - 1000) }]);
		mocks.overview.mockRejectedValue({ code: "quota" });
		const response = await getTrafficOverviewFn({ data: input });
		expect(response.totals.total).toBe(10);
		expect(response.fetchedAt).toBe(result.fetchedAt);
		expect(response.warnings).toContain("stale_cache");
	});
	it("does not turn revoked authorization into a zero or cached successful report", async () => {
		mocks.results.push([{ payload: result, expiresAt: new Date(Date.now() - 1000) }]);
		mocks.overview.mockRejectedValue({ code: "auth_revoked" });
		await expect(getTrafficOverviewFn({ data: input })).rejects.toThrow("ANALYTICS_RECONNECT_REQUIRED");
		expect(mocks.writes).toContainEqual(expect.objectContaining({ status: "needs_reauth" }));
	});
	it("adds exact path restriction to the same parent filter for page details", async () => {
		mocks.results.push([]);
		await getTrafficPageDetailFn({
			data: { ...input, conditions: [{ mode: "include", operator: "subtree", value: "/jobs/" }], path: "/jobs/one" },
		});
		expect(mocks.overview).toHaveBeenCalledWith(
			expect.objectContaining({
				conditions: [
					{ mode: "include", operator: "subtree", value: "/jobs" },
					{ mode: "include", operator: "exact", value: "/jobs/one" },
				],
			}),
		);
	});
	it("sanitizes unknown provider errors instead of returning credentials or raw payloads", () => {
		expect(trafficProviderError(new Error("request failed: private-access-token")).message).toBe(
			"ANALYTICS_UNAVAILABLE",
		);
	});
});
