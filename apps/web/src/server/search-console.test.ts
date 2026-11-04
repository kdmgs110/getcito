import { gscConnections, gscOAuthStates, gscQueryCache } from "@workspace/lib/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	results: [] as unknown[][],
	writes: [] as unknown[],
	deletes: [] as unknown[],
	wheres: [] as unknown[],
	selections: [] as unknown[],
	access: vi.fn(),
	connection: vi.fn(),
	token: vi.fn(),
	revision: vi.fn(),
	report: vi.fn(),
	properties: vi.fn(),
	manage: vi.fn(),
	reauth: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (value: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@workspace/lib/search-console/server", () => ({
	fetchSearchConsoleReport: mocks.report,
	listSearchConsoleSites: mocks.properties,
}));
vi.mock("./search-console-oauth", () => ({ startSearchConsoleOAuth: vi.fn() }));
vi.mock("./traffic-runtime", () => ({ trafficCanManage: mocks.manage }));
vi.mock("./search-console-runtime", () => ({
	requireSearchConsoleAccess: mocks.access,
	currentSearchConsoleConnection: mocks.connection,
	searchConsoleAccessToken: mocks.token,
	assertSearchConsoleRevision: mocks.revision,
	searchConsoleConfigured: () => true,
	newSearchConsoleRevision: () => "new-revision",
	markSearchConsoleReauth: mocks.reauth,
	searchConsoleCacheKey: (connection: unknown, hosts: unknown, filters: unknown) =>
		JSON.stringify({ connection, hosts, filters }),
}));
vi.mock("@workspace/lib/db/db", () => {
	const query = () => {
		const chain = {
			from: (value: unknown) => {
				mocks.selections.push(value);
				return chain;
			},
			where: (value: unknown) => {
				mocks.wheres.push(value);
				return chain;
			},
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
			// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are awaitable.
			then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
		};
		return chain;
	};
	const db = {
		select: query,
		update: query,
		insert: query,
		delete: (table: unknown) => {
			mocks.deletes.push(table);
			return query();
		},
		transaction: async (fn: (tx: unknown) => unknown) => fn(db),
	};
	return { db };
});

import {
	connectSearchConsolePropertyFn,
	disconnectSearchConsoleFn,
	getSearchConsolePropertiesFn,
	getSearchConsoleReportFn,
	getSearchConsoleStatusFn,
} from "./search-console";

const input = {
	brandId: "brand-a",
	startDate: "2026-10-01",
	endDate: "2026-10-28",
	keyword: "",
	aiQuestionsOnly: false,
	urlConditions: [],
};
const report = {
	rows: [],
	totals: { clicks: 3, impressions: 100, ctr: 0.03, position: 8.2 },
	fetchedAt: "2026-10-29T10:00:00.000Z",
	truncated: false,
};
const connection = {
	brandId: "brand-a",
	propertyId: "https://example.com/",
	revision: "revision-a",
	status: "connected",
	refreshTokenCiphertext: "private-ciphertext",
	connectedBy: "private-user",
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
	for (const values of [mocks.results, mocks.writes, mocks.deletes, mocks.wheres, mocks.selections]) values.length = 0;
	mocks.access.mockReset().mockResolvedValue({ sites: ["example.com"], session: { user: { id: "user-a" } } });
	mocks.connection.mockReset().mockResolvedValue(connection);
	mocks.token.mockReset().mockResolvedValue("private-access");
	mocks.revision.mockReset().mockResolvedValue(undefined);
	mocks.report.mockReset().mockResolvedValue(report);
	mocks.properties.mockReset().mockResolvedValue([{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }]);
	mocks.manage.mockReset().mockResolvedValue(false);
	mocks.reauth.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("Search Console connection settings", () => {
	it("returns only safe status fields and suppresses a property outside the current brand domains", async () => {
		const status = await getSearchConsoleStatusFn({ data: { brandId: "brand-a" } });
		expect(status).toEqual({
			configured: true,
			canManage: false,
			oauthConnected: true,
			needsReauth: false,
			propertyId: "https://example.com/",
			connectionRevision: "revision-a",
		});
		expect(JSON.stringify(status)).not.toContain("private");
		mocks.connection.mockResolvedValue({ ...connection, propertyId: "https://other.com/", status: "needs_reauth" });
		expect((await getSearchConsoleStatusFn({ data: { brandId: "brand-a" } })).propertyId).toBeNull();
	});
	it("lists only accessible matching properties and requires manager access", async () => {
		mocks.properties.mockResolvedValue([
			{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
			{ siteUrl: "https://other.com/", permissionLevel: "siteOwner" },
			{ siteUrl: "https://example.com/", permissionLevel: "siteUnverifiedUser" },
		]);
		expect(await getSearchConsolePropertiesFn({ data: { brandId: "brand-a" } })).toEqual([
			{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
		]);
		expect(mocks.access).toHaveBeenCalledWith("brand-a", true);
		expect(mocks.revision).toHaveBeenCalledWith("brand-a", "revision-a");
	});
	it("does not allow an ordinary member to change property or disconnect", async () => {
		mocks.access.mockRejectedValue(new Error("Forbidden"));
		await expect(
			connectSearchConsolePropertyFn({ data: { brandId: "brand-a", siteUrl: "https://example.com/" } }),
		).rejects.toThrow("Forbidden");
		await expect(disconnectSearchConsoleFn({ data: { brandId: "brand-a" } })).rejects.toThrow("Forbidden");
		expect(mocks.properties).not.toHaveBeenCalled();
		expect(mocks.writes).toHaveLength(0);
		expect(mocks.deletes).toHaveLength(0);
	});
	it("rejects an out-of-brand property before contacting Google and a forged matching property before writes", async () => {
		await expect(
			connectSearchConsolePropertyFn({ data: { brandId: "brand-a", siteUrl: "https://other.com/" } }),
		).rejects.toThrow("GSC_PROPERTY_FORBIDDEN");
		expect(mocks.properties).not.toHaveBeenCalled();
		mocks.properties.mockResolvedValue([]);
		await expect(
			connectSearchConsolePropertyFn({ data: { brandId: "brand-a", siteUrl: "https://example.com/" } }),
		).rejects.toThrow("GSC_PROPERTY_FORBIDDEN");
		expect(mocks.writes).toHaveLength(0);
	});
	it("rechecks manager access after Google and refuses a concurrently changed connection", async () => {
		mocks.access.mockResolvedValueOnce({ sites: ["example.com"] }).mockRejectedValueOnce(new Error("Forbidden"));
		await expect(
			connectSearchConsolePropertyFn({ data: { brandId: "brand-a", siteUrl: "https://example.com/" } }),
		).rejects.toThrow("Forbidden");
		expect(mocks.writes).toHaveLength(0);
		mocks.access.mockResolvedValue({ sites: ["example.com"] });
		await expect(
			connectSearchConsolePropertyFn({ data: { brandId: "brand-a", siteUrl: "https://example.com/" } }),
		).rejects.toThrow("GSC_CONNECTION_CHANGED");
		expect(mocks.deletes).toHaveLength(0);
	});
	it("binds only a verified property with a new revision and clears only the GSC brand cache", async () => {
		mocks.results.push([{ id: "brand-a" }]);
		await connectSearchConsolePropertyFn({ data: { brandId: "brand-a", siteUrl: "https://example.com/" } });
		expect(mocks.writes).toContainEqual(
			expect.objectContaining({ propertyId: "https://example.com/", revision: "new-revision" }),
		);
		expect(mocks.deletes).toEqual([gscQueryCache]);
		const queries = mocks.wheres.map((value) =>
			new PgDialect().sqlToQuery(value as Parameters<PgDialect["sqlToQuery"]>[0]),
		);
		expect(queries[0].params).toEqual(["brand-a", "revision-a"]);
		expect(queries[1].params).toEqual(["brand-a"]);
	});
	it("disconnects GSC credentials, states and cache only, without Google revocation", async () => {
		expect(await disconnectSearchConsoleFn({ data: { brandId: "brand-a" } })).toEqual({ disconnected: true });
		expect(mocks.deletes).toEqual([gscOAuthStates, gscQueryCache, gscConnections]);
		for (const where of mocks.wheres)
			expect(new PgDialect().sqlToQuery(where as Parameters<PgDialect["sqlToQuery"]>[0]).params).toEqual(["brand-a"]);
		expect(mocks.token).not.toHaveBeenCalled();
		expect(mocks.properties).not.toHaveBeenCalled();
	});
});

describe("Search Console cache and report isolation", () => {
	it("checks membership before cache, connection or provider access", async () => {
		mocks.access.mockRejectedValue(new Error("Forbidden"));
		await expect(getSearchConsoleReportFn({ data: input })).rejects.toThrow("Forbidden");
		expect(mocks.connection).not.toHaveBeenCalled();
		expect(mocks.selections).toHaveLength(0);
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("returns cached data without refreshing credentials, scoped to brand and revision", async () => {
		mocks.results.push([{ payload: report }]);
		expect(await getSearchConsoleReportFn({ data: input })).toEqual(report);
		expect(mocks.token).not.toHaveBeenCalled();
		expect(mocks.report).not.toHaveBeenCalled();
		const query = new PgDialect().sqlToQuery(mocks.wheres[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
		expect(query.sql).toContain('"gsc_query_cache"."brand_id"');
		expect(query.sql).toContain('"gsc_query_cache"."connection_revision"');
		expect(query.params).toEqual(expect.arrayContaining(["brand-a", "revision-a"]));
		expect(mocks.revision).toHaveBeenCalledWith("brand-a", "revision-a");
	});
	it("rejects revoked, missing and out-of-brand properties before querying cache", async () => {
		for (const [record, error] of [
			[undefined, "GSC_RECONNECT_REQUIRED"],
			[{ ...connection, status: "needs_reauth" }, "GSC_RECONNECT_REQUIRED"],
			[{ ...connection, propertyId: null }, "GSC_PROPERTY_REQUIRED"],
			[{ ...connection, propertyId: "https://other.com/" }, "GSC_PROPERTY_FORBIDDEN"],
		] as const) {
			mocks.connection.mockResolvedValue(record);
			await expect(getSearchConsoleReportFn({ data: input })).rejects.toThrow(error);
		}
		expect(mocks.selections).toHaveLength(0);
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("rechecks membership before returning a cache hit if access was revoked during lookup", async () => {
		mocks.results.push([{ payload: report }]);
		mocks.access.mockResolvedValueOnce({ sites: ["example.com"] }).mockRejectedValueOnce(new Error("Forbidden"));
		await expect(getSearchConsoleReportFn({ data: input })).rejects.toThrow("Forbidden");
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("passes only server-selected property and brand hosts with the validated filters", async () => {
		const forged = {
			...input,
			propertyId: "sc-domain:evil.com",
			allowedHostnames: ["evil.com"],
			aiQuestionsOnly: true,
			urlConditions: [{ operator: "notContains" as const, value: "/archive" }],
		};
		await getSearchConsoleReportFn({ data: forged });
		expect(mocks.report).toHaveBeenCalledWith("private-access", "https://example.com/", ["example.com"], {
			startDate: input.startDate,
			endDate: input.endDate,
			keyword: "",
			aiQuestionsOnly: true,
			urlConditions: [{ operator: "notContains", value: "/archive" }],
		});
	});
	it("deduplicates same-scope requests while keeping distinct AI conditions separate", async () => {
		let release: (value: typeof report) => void = () => {};
		mocks.report.mockImplementation(
			() =>
				new Promise<typeof report>((resolve) => {
					release = resolve;
				}),
		);
		const first = getSearchConsoleReportFn({ data: input });
		const second = getSearchConsoleReportFn({ data: input });
		await vi.waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
		release(report);
		expect(await Promise.all([first, second])).toEqual([report, report]);
		mocks.report.mockResolvedValue(report);
		await getSearchConsoleReportFn({ data: { ...input, aiQuestionsOnly: true } });
		expect(mocks.report).toHaveBeenCalledTimes(2);
	});
	it("never stores a result if the connection changed during fetch", async () => {
		mocks.revision.mockRejectedValue(new Error("GSC_CONNECTION_CHANGED"));
		await expect(getSearchConsoleReportFn({ data: input })).rejects.toThrow("GSC_CONNECTION_CHANGED");
		expect(mocks.writes).toHaveLength(0);
	});
	it("rechecks each deduplicated caller's membership before returning a shared result", async () => {
		let release: (value: typeof report) => void = () => {};
		mocks.report.mockImplementation(
			() =>
				new Promise<typeof report>((resolve) => {
					release = resolve;
				}),
		);
		mocks.access
			.mockResolvedValueOnce({ sites: ["example.com"] })
			.mockResolvedValueOnce({ sites: ["example.com"] })
			.mockResolvedValueOnce({ sites: ["example.com"] })
			.mockRejectedValueOnce(new Error("Forbidden"));
		const first = getSearchConsoleReportFn({ data: input });
		const second = getSearchConsoleReportFn({ data: input });
		const results = Promise.allSettled([first, second]);
		await vi.waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
		release(report);
		expect(await results).toEqual([
			{ status: "fulfilled", value: report },
			{ status: "rejected", reason: expect.objectContaining({ message: "Forbidden" }) },
		]);
	});
	it("deletes a just-written cache entry if access is lost before the result returns", async () => {
		mocks.access.mockResolvedValueOnce({ sites: ["example.com"] }).mockRejectedValueOnce(new Error("Forbidden"));
		await expect(getSearchConsoleReportFn({ data: input })).rejects.toThrow("Forbidden");
		expect(mocks.writes).toHaveLength(1);
		expect(mocks.deletes).toEqual([gscQueryCache]);
	});
	it("marks revoked credentials for reconnect without writing a successful or zero report", async () => {
		mocks.report.mockRejectedValue(new Error("GSC_RECONNECT_REQUIRED"));
		await expect(getSearchConsoleReportFn({ data: input })).rejects.toThrow(/^GSC_RECONNECT_REQUIRED$/);
		expect(mocks.reauth).toHaveBeenCalledWith(connection);
		expect(mocks.writes).toHaveLength(0);
	});
});
