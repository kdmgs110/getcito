import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	results: [] as unknown[][],
	wheres: [] as unknown[],
	writes: [] as unknown[],
	access: vi.fn(),
	connection: vi.fn(),
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
}));
vi.mock("@workspace/lib/db/db", () => {
	const query = () => {
		const chain = {
			from: () => chain,
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
			orderBy: () => Promise.resolve(mocks.results.shift() ?? []),
			returning: () => Promise.resolve(mocks.results.shift() ?? []),
			for: () => Promise.resolve(mocks.results.shift() ?? []),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle builders are intentionally awaitable.
			then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve),
		};
		return chain;
	};
	const db = {
		select: query,
		update: query,
		insert: query,
		delete: query,
		execute: vi.fn(),
		transaction: async (fn: (tx: unknown) => unknown) => fn(db),
	};
	return { db };
});

import {
	deleteTrafficViewFn,
	listTrafficViewsFn,
	normalizedTrafficViewName,
	reorderTrafficViewsFn,
	saveTrafficViewFn,
} from "./traffic-saved-views";

const brandId = "brand-a";
const id = "00000000-0000-4000-8000-000000000001";
const user = { session: { user: { id: "manager" } }, sites: ["example.com"] };
const view = {
	id,
	brandId,
	hostname: "example.com",
	name: "Top",
	normalizedName: "top",
	conditions: [{ mode: "include", operator: "exact", value: "/" }],
	filterSchemaVersion: 1,
	sortOrder: 0,
	revision: 2,
	createdBy: "manager",
	updatedBy: "manager",
	createdAt: new Date(),
	updatedAt: new Date(),
};

beforeEach(() => {
	mocks.results.length = 0;
	mocks.wheres.length = 0;
	mocks.writes.length = 0;
	mocks.access.mockReset().mockResolvedValue(user);
	mocks.connection.mockReset().mockResolvedValue({
		brandId,
		propertyId: "123",
		hostname: "example.com",
		status: "connected",
		revision: "connection-revision",
	});
});

describe("Shared traffic view authorization and concurrency", () => {
	it("requires read access before listing views and limits the SQL to that brand", async () => {
		mocks.results.push([view]);
		const result = await listTrafficViewsFn({ data: { brandId } });
		expect(mocks.access).toHaveBeenCalledWith(brandId);
		expect(result[0].conditions[0].value).toBe("/");
		expect(result[0].updatedAt).toEqual(view.updatedAt.toISOString());
		const sql = new PgDialect().sqlToQuery(mocks.wheres[0] as never);
		expect(sql.params).toContain(brandId);
	});
	it("does not execute writes when the member cannot manage the organization", async () => {
		mocks.access.mockRejectedValue(new Error("ANALYTICS_FORBIDDEN"));
		await expect(
			saveTrafficViewFn({ data: { brandId, hostname: "example.com", name: "Top", conditions: [] } }),
		).rejects.toThrow("ANALYTICS_FORBIDDEN");
		expect(mocks.access).toHaveBeenCalledWith(brandId, true);
		expect(mocks.writes).toHaveLength(0);
	});
	it("binds updates to brand, site, view and expected revision", async () => {
		mocks.results.push([view]);
		await saveTrafficViewFn({
			data: { brandId, id, revision: 1, hostname: "example.com", name: "Top", conditions: view.conditions as never },
		});
		const sql = new PgDialect().sqlToQuery(mocks.wheres[0] as never);
		expect(sql.params).toEqual(expect.arrayContaining([brandId, "example.com", id, 1]));
	});
	it("reports a conflict instead of overwriting a concurrently updated or foreign view", async () => {
		mocks.results.push([]);
		await expect(
			saveTrafficViewFn({ data: { brandId, id, revision: 1, hostname: "example.com", name: "Top", conditions: [] } }),
		).rejects.toThrow("TRAFFIC_VIEW_CONFLICT");
	});
	it("rejects a view aimed at another website before making any DB write", async () => {
		await expect(
			saveTrafficViewFn({ data: { brandId, hostname: "foreign.example", name: "Foreign", conditions: [] } }),
		).rejects.toThrow("TRAFFIC_INVALID_SITE");
		expect(mocks.writes).toHaveLength(0);
	});
	it("does not delete another brand's view or a changed revision", async () => {
		mocks.results.push([]);
		await expect(deleteTrafficViewFn({ data: { brandId, id, revision: 1 } })).rejects.toThrow("TRAFFIC_VIEW_CONFLICT");
		const sql = new PgDialect().sqlToQuery(mocks.wheres[0] as never);
		expect(sql.params).toEqual(expect.arrayContaining([brandId, id, 1]));
	});
	it("rejects reorder operations containing unavailable view ids", async () => {
		mocks.results.push([]);
		await expect(reorderTrafficViewsFn({ data: { brandId, ids: [id] } })).rejects.toThrow("TRAFFIC_VIEW_NOT_FOUND");
		expect(mocks.writes).toHaveLength(0);
	});
	it("rejects partial reorder lists after taking the site lock", async () => {
		mocks.results.push([{ id, hostname: "example.com" }], [{ id }, { id: "00000000-0000-4000-8000-000000000002" }]);
		await expect(reorderTrafficViewsFn({ data: { brandId, ids: [id] } })).rejects.toThrow("TRAFFIC_VIEW_CONFLICT");
		expect(mocks.writes).toHaveLength(0);
	});
	it("normalizes names for shared uniqueness without altering the displayed language", () => {
		expect(normalizedTrafficViewName("  Ｔｏｐ　 Page ")).toBe("top page");
		expect(normalizedTrafficViewName("トップページ")).toBe("トップページ");
	});
});

describe("Saved conversion view preferences", () => {
	it("preserves conversion preferences when legacy callers omit them", async () => {
		mocks.results.push([{ ...view, conversionGoalId: id, analysisTab: "conversions" }]);
		const result = await saveTrafficViewFn({
			data: { brandId, id, revision: 1, hostname: "example.com", name: "Top", conditions: [] },
		});
		expect(result.conversionGoalId).toBe(id);
		expect(result.analysisTab).toBe("conversions");
		expect(mocks.writes[0]).not.toHaveProperty("conversionGoalId");
		expect(mocks.writes[0]).not.toHaveProperty("analysisTab");
	});
	it("can explicitly clear the selected CV and return to traffic", async () => {
		mocks.results.push([{ ...view, conversionGoalId: null, analysisTab: "traffic" }]);
		await saveTrafficViewFn({
			data: {
				brandId,
				id,
				revision: 1,
				hostname: "example.com",
				name: "Top",
				conditions: [],
				conversionGoalId: null,
				analysisTab: "traffic",
			},
		});
		expect(mocks.writes[0]).toMatchObject({ conversionGoalId: null, analysisTab: "traffic" });
	});
	it("validates CV membership under the current property and site before writing", async () => {
		mocks.results.push([{ id: brandId }], [{ id }], [{ ...view, conversionGoalId: id, analysisTab: "conversions" }]);
		await saveTrafficViewFn({
			data: {
				brandId,
				id,
				revision: 1,
				hostname: "example.com",
				name: "Top",
				conditions: [],
				conversionGoalId: id,
				analysisTab: "conversions",
			},
		});
		const query = new PgDialect().sqlToQuery(mocks.wheres[1] as never);
		expect(query.params).toEqual(expect.arrayContaining([id, brandId, "123", "example.com", true]));
		expect(mocks.writes[0]).toMatchObject({ conversionGoalId: id, analysisTab: "conversions" });
	});
	it("rejects a foreign, disabled or obsolete CV selection", async () => {
		mocks.results.push([{ id: brandId }], []);
		await expect(
			saveTrafficViewFn({
				data: {
					brandId,
					id,
					revision: 1,
					hostname: "example.com",
					name: "Top",
					conditions: [],
					conversionGoalId: id,
					analysisTab: "conversions",
				},
			}),
		).rejects.toThrow("CONVERSION_GOAL_NOT_FOUND");
		expect(mocks.writes).toHaveLength(0);
	});
	it("rejects a CV preference if the property reconnects before its lock", async () => {
		mocks.results.push([]);
		await expect(
			saveTrafficViewFn({
				data: {
					brandId,
					id,
					revision: 1,
					hostname: "example.com",
					name: "Top",
					conditions: [],
					conversionGoalId: id,
					analysisTab: "conversions",
				},
			}),
		).rejects.toThrow("ANALYTICS_CONNECTION_CHANGED");
		expect(mocks.writes).toHaveLength(0);
	});
});
