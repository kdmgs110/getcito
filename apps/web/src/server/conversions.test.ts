import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	results: [] as unknown[][],
	wheres: [] as unknown[],
	writes: [] as Record<string, unknown>[],
	locks: [] as string[],
	access: vi.fn(),
	connection: vi.fn(),
	token: vi.fn(),
	revision: vi.fn(),
	events: vi.fn(),
	report: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (data: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("./traffic-runtime", () => ({
	requireTrafficAccess: mocks.access,
	currentTrafficConnection: mocks.connection,
	trafficAccessToken: mocks.token,
	assertTrafficRevision: mocks.revision,
}));
vi.mock("@workspace/lib/analytics/conversions-server", () => ({
	listGA4KeyEvents: mocks.events,
	fetchConversionReport: mocks.report,
}));
vi.mock("@workspace/lib/db/db", () => {
	const query = () => {
		const chain = {
			from: () => chain,
			where: (value: unknown) => {
				mocks.wheres.push(value);
				return chain;
			},
			set: (value: Record<string, unknown>) => {
				mocks.writes.push(value);
				return chain;
			},
			values: (value: Record<string, unknown>) => {
				mocks.writes.push(value);
				return chain;
			},
			limit: () => Promise.resolve(mocks.results.shift() ?? []),
			orderBy: () => Promise.resolve(mocks.results.shift() ?? []),
			returning: () => Promise.resolve(mocks.results.shift() ?? []),
			for: (mode: string) => {
				mocks.locks.push(mode);
				return Promise.resolve(mocks.results.shift() ?? []);
			},
			onConflictDoUpdate: () => Promise.resolve(),
			// biome-ignore lint/suspicious/noThenProperty: Models the awaitable Drizzle builder.
			then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve),
		};
		return chain;
	};
	const db = {
		select: query,
		insert: query,
		update: query,
		delete: query,
		execute: vi.fn(),
		transaction: async (operation: (tx: unknown) => unknown) => operation(db),
	};
	return { db };
});

import {
	conversionProviderError,
	getConversionReportFn,
	listConversionEventsFn,
	listConversionGoalsFn,
	saveConversionGoalFn,
} from "./conversions";

const brandId = "brand-a",
	id = "00000000-0000-4000-8000-000000000001";
const connection = {
	brandId,
	propertyId: "123",
	hostname: "example.com",
	status: "connected",
	revision: "revision-a",
	measurementMode: "observed_session_start",
};
const goal = {
	id,
	brandId,
	propertyId: "123",
	hostname: "example.com",
	eventName: "応募完了",
	displayName: "応募完了",
	enabled: true,
	revision: 1,
	ga4Name: "properties/123/keyEvents/5",
	ga4CreateTime: new Date("2026-10-01T00:00:00Z"),
	countingMethod: "ONCE_PER_EVENT",
	createdBy: "manager",
	updatedBy: "manager",
	createdAt: new Date(),
	updatedAt: new Date(),
};
const event = {
	name: goal.ga4Name,
	eventName: goal.eventName,
	createTime: goal.ga4CreateTime.toISOString(),
	countingMethod: goal.countingMethod,
};
const input = { brandId, goalId: id, from: "2026-10-01", to: "2026-10-28", conditions: [], grain: "day" as const };
const report = {
	totals: {
		cv: 3,
		aiCv: 2,
		sessions: null,
		aiSessions: null,
		cvSessions: null,
		aiCvSessions: null,
		cvr: null,
		aiCvr: null,
	},
	points: [],
	sources: [],
	pages: { rows: [], totalRows: 0, page: 1, pageSize: 10 },
	measurementScope: "cv_event_host",
	pageAttributionSupported: false,
	cvrSupported: false,
	warnings: ["cross_host_landing_unverified"],
	fetchedAt: "2026-10-29T10:00:00Z",
	timeZone: "Asia/Tokyo",
};
beforeEach(() => {
	mocks.results.length = 0;
	mocks.wheres.length = 0;
	mocks.writes.length = 0;
	mocks.locks.length = 0;
	mocks.access.mockReset().mockResolvedValue({ session: { user: { id: "manager" } }, sites: ["example.com"] });
	mocks.connection.mockReset().mockResolvedValue(connection);
	mocks.token.mockReset().mockResolvedValue("private-access-token");
	mocks.revision.mockReset().mockResolvedValue(undefined);
	mocks.events.mockReset().mockResolvedValue([event]);
	mocks.report.mockReset().mockResolvedValue(report);
});
const params = (index: number) => new PgDialect().sqlToQuery(mocks.wheres[index] as never).params;
describe("Conversion goals authorization and metadata", () => {
	it("lists only the authorized brand/property/host and exposes no token", async () => {
		mocks.results.push([goal]);
		const result = await listConversionGoalsFn({ data: { brandId } });
		expect(mocks.access).toHaveBeenCalledWith(brandId, false);
		expect(params(0)).toEqual([brandId, "123", "example.com"]);
		expect(result[0].eventName).toBe("応募完了");
		expect(result[0].ga4CreateTime).toBe(event.createTime);
		expect(JSON.stringify(result)).not.toContain("private-access-token");
	});
	it("requires a manager before listing provider events or writing settings", async () => {
		mocks.access.mockRejectedValue(new Error("ANALYTICS_FORBIDDEN"));
		await expect(listConversionEventsFn({ data: { brandId } })).rejects.toThrow("ANALYTICS_FORBIDDEN");
		await expect(
			saveConversionGoalFn({ data: { brandId, eventName: goal.eventName, displayName: "応募", enabled: true } }),
		).rejects.toThrow("ANALYTICS_FORBIDDEN");
		expect(mocks.access).toHaveBeenCalledWith(brandId, true);
		expect(mocks.events).not.toHaveBeenCalled();
		expect(mocks.writes).toHaveLength(0);
	});
	it("refuses a property whose host is no longer a brand site", async () => {
		mocks.access.mockResolvedValue({ sites: ["other.example"], session: { user: { id: "manager" } } });
		await expect(listConversionGoalsFn({ data: { brandId } })).rejects.toThrow("TRAFFIC_INVALID_SITE");
	});
	it("saves an actual Unicode GA4 event and locks the current connection", async () => {
		mocks.results.push([{ brandId }], [{ count: 0 }], [goal], []);
		const result = await saveConversionGoalFn({
			data: { brandId, eventName: "応募完了", displayName: "  応募完了  ", enabled: true },
		});
		expect(result.displayName).toBe("応募完了");
		expect(mocks.locks).toEqual(["update"]);
		expect(params(0)).toEqual(expect.arrayContaining([brandId, "revision-a", "123", "example.com", "connected"]));
		expect(mocks.writes[0]).toMatchObject({
			brandId,
			propertyId: "123",
			hostname: "example.com",
			eventName: "応募完了",
			ga4Name: event.name,
			countingMethod: "ONCE_PER_EVENT",
		});
		expect(mocks.events).toHaveBeenCalledWith("private-access-token", "123");
	});
	it("rejects unregistered event names before making any write", async () => {
		await expect(
			saveConversionGoalFn({ data: { brandId, eventName: "invented", displayName: "偽CV", enabled: true } }),
		).rejects.toThrow("CONVERSION_EVENT_MISSING");
		expect(mocks.writes).toHaveLength(0);
	});
	it("does not attach a goal if the connection changed during provider lookup", async () => {
		mocks.results.push([]);
		await expect(
			saveConversionGoalFn({ data: { brandId, eventName: goal.eventName, displayName: "応募", enabled: true } }),
		).rejects.toThrow("ANALYTICS_CONNECTION_CHANGED");
		expect(mocks.writes).toHaveLength(0);
	});
	it("binds updates to goal, brand, property, host and expected revision", async () => {
		mocks.results.push([goal], [{ brandId }], [{ ...goal, revision: 2 }], []);
		await saveConversionGoalFn({
			data: { brandId, id, revision: 1, eventName: goal.eventName, displayName: "New", enabled: true },
		});
		expect(params(2)).toEqual(expect.arrayContaining([id, brandId, "123", "example.com", 1]));
	});
	it("rejects a stale update without overwriting it", async () => {
		mocks.results.push([{ ...goal, revision: 2 }]);
		await expect(
			saveConversionGoalFn({
				data: { brandId, id, revision: 1, eventName: goal.eventName, displayName: "New", enabled: true },
			}),
		).rejects.toThrow("CONVERSION_GOAL_CONFLICT");
		expect(mocks.writes).toHaveLength(0);
	});
	it("can disable a removed provider event without querying or changing Google", async () => {
		mocks.results.push([goal], [{ brandId }], [{ ...goal, enabled: false, revision: 2 }], []);
		const result = await saveConversionGoalFn({
			data: { brandId, id, revision: 1, eventName: goal.eventName, displayName: "応募", enabled: false },
		});
		expect(result.enabled).toBe(false);
		expect(mocks.events).not.toHaveBeenCalled();
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("enforces the per-site goal limit", async () => {
		mocks.results.push([{ brandId }], [{ count: 100 }]);
		await expect(
			saveConversionGoalFn({ data: { brandId, eventName: goal.eventName, displayName: "応募", enabled: true } }),
		).rejects.toThrow("CONVERSION_GOAL_LIMIT");
		expect(mocks.writes).toHaveLength(0);
	});
	it("sanitizes provider errors instead of returning token-bearing messages", async () => {
		mocks.events.mockRejectedValue(new Error("https://google.invalid?token=secret"));
		await expect(listConversionEventsFn({ data: { brandId } })).rejects.toThrow(/^ANALYTICS_UNAVAILABLE$/);
		expect(conversionProviderError({ code: "quota" }).message).toBe("ANALYTICS_QUOTA");
	});
});
describe("Conversion report ownership and cache races", () => {
	it("never reads a foreign or obsolete goal by id alone", async () => {
		mocks.results.push([]);
		await expect(getConversionReportFn({ data: input })).rejects.toThrow("CONVERSION_GOAL_NOT_FOUND");
		expect(params(0)).toEqual(expect.arrayContaining([id, brandId, "123", "example.com"]));
		expect(mocks.report).not.toHaveBeenCalled();
	});
	it("refuses disabled goals before provider reports or cached data", async () => {
		mocks.results.push([{ ...goal, enabled: false }]);
		await expect(getConversionReportFn({ data: input })).rejects.toThrow("CONVERSION_GOAL_DISABLED");
		expect(mocks.report).not.toHaveBeenCalled();
		expect(mocks.events).not.toHaveBeenCalled();
	});
	it("rejects a removed GA4 event rather than serving a cached number", async () => {
		mocks.results.push([goal]);
		mocks.events.mockResolvedValue([]);
		await expect(getConversionReportFn({ data: input })).rejects.toThrow("CONVERSION_EVENT_MISSING");
		expect(mocks.wheres).toHaveLength(1);
	});
	it("returns verified cached scope and warnings without fetching reports", async () => {
		mocks.results.push([goal], [{ payload: report, expiresAt: new Date(Date.now() + 60000) }], [goal]);
		const result = await getConversionReportFn({ data: input });
		expect(result).toEqual(report);
		expect(mocks.report).not.toHaveBeenCalled();
	});
	it("passes the real goal and normalized conditions into the dedicated report loader", async () => {
		mocks.results.push([goal], [], [goal], [goal]);
		const result = await getConversionReportFn({ data: input });
		expect(result.totals.aiCv).toBe(2);
		expect(mocks.report).toHaveBeenCalledWith(
			expect.objectContaining({
				eventName: goal.eventName,
				propertyId: "123",
				hostname: "example.com",
				measurementMode: "observed_session_start",
				grain: "day",
			}),
		);
		expect(mocks.writes[0].payload).toEqual(report);
		expect(mocks.writes[0].connectionRevision).toBe("revision-a");
	});
	it("does not cache a result if the goal is changed while GA4 is loading", async () => {
		mocks.results.push([goal], [], [{ ...goal, revision: 2 }]);
		await expect(getConversionReportFn({ data: input })).rejects.toThrow("CONVERSION_GOAL_CONFLICT");
		expect(mocks.writes).toHaveLength(0);
	});
	it("does not return a result after a concurrent disconnect", async () => {
		mocks.results.push([goal], []);
		mocks.revision.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("ANALYTICS_CONNECTION_CHANGED"));
		await expect(getConversionReportFn({ data: input })).rejects.toThrow("ANALYTICS_CONNECTION_CHANGED");
		expect(mocks.writes).toHaveLength(0);
	});
	it("purges an inserted result when the goal changes during cache insert", async () => {
		mocks.results.push([goal], [], [goal], [{ ...goal, enabled: false }], []);
		await expect(getConversionReportFn({ data: input })).rejects.toThrow("CONVERSION_GOAL_DISABLED");
		expect(mocks.writes).toHaveLength(1);
		expect(params(mocks.wheres.length - 1)).toContain(mocks.writes[0].cacheKey);
	});
	it("uses a new cache key for a changed goal revision", async () => {
		mocks.results.push([goal], [], [goal], [goal]);
		await getConversionReportFn({ data: input });
		const first = mocks.writes[0].cacheKey;
		const changed = { ...goal, revision: 2 };
		mocks.results.push([changed], [], [changed], [changed]);
		await getConversionReportFn({ data: input });
		expect(mocks.writes[1].cacheKey).not.toBe(first);
	});
});
