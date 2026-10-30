import type { SavedTrafficView } from "@workspace/lib/analytics";
import { describe, expect, it } from "vitest";
import {
	duplicateViewDraft,
	parseConditions,
	ratio,
	reorderSiteViewIds,
	resolveViewConditions,
	scopeChange,
	trafficDomainScopeKey,
	validateTrafficSearch,
	validDateRange,
	viewStorageKey,
} from "./traffic-state";

const view: SavedTrafficView = {
	id: "view-1",
	brandId: "brand-1",
	hostname: "example.com",
	name: "Home",
	conditions: [{ mode: "include", operator: "exact", value: "/" }],
	sortOrder: 0,
	revision: 1,
	updatedAt: "2026-10-30",
};
describe("traffic URL and view state", () => {
	it("keys all-domain reports by canonical domain membership without changing exact-domain reports", () => {
		const main = "www.example.com";
		const content = "content.example.com";
		expect(trafficDomainScopeKey([main, content, main])).toBe(trafficDomainScopeKey([content, main]));
		expect(trafficDomainScopeKey([main, content])).not.toBe(trafficDomainScopeKey([main]));
		expect(trafficDomainScopeKey([main, content], main)).toBe(trafficDomainScopeKey([main], main));
	});
	it("retains domain scope and clears the previous page's domain with report scope changes", () => {
		expect(validateTrafficSearch({ hostname: "all", detailHostname: "content.example.com" })).toEqual({
			hostname: "all",
			detailHostname: "content.example.com",
		});
		const changed = {
			hostname: "all",
			viewId: "old",
			conditions: "[]",
			detailHostname: "content.example.com",
			...scopeChange({ hostname: "example.com", viewId: undefined, conditions: undefined }),
		};
		expect(changed).toMatchObject({
			hostname: "example.com",
			viewId: undefined,
			conditions: undefined,
			detail: undefined,
			detailHostname: undefined,
		});
	});
	it("restores a saved view and allows explicit temporary all-path conditions", () => {
		expect(resolveViewConditions({ viewId: view.id }, [view], "example.com").conditions).toEqual(view.conditions);
		const changed = resolveViewConditions({ viewId: view.id, conditions: "[]" }, [view], "example.com");
		expect(changed.view).toEqual(view);
		expect(changed.conditions).toEqual([]);
	});
	it("does not apply a deleted or other-site saved view", () => {
		const changed = resolveViewConditions({ viewId: view.id }, [view], "other.example.com");
		expect(changed.invalidView).toBe(true);
		expect(changed.conditions).toEqual([]);
	});
	it("rejects malformed URL state and constrains pagination", () => {
		expect(parseConditions('[{"operator":"sql","mode":"include","value":"/"}]')).toBeNull();
		expect(parseConditions("{")).toBeNull();
		expect(validateTrafficSearch({ page: -1, pageSize: 10000, grain: "year", conditions: "[1]" })).toEqual({});
		expect(validateTrafficSearch({ page: "2", pageSize: "25", grain: "week" })).toEqual({
			page: 2,
			pageSize: 25,
			grain: "week",
		});
	});
	it("validates calendar dates and caps the range", () => {
		expect(validDateRange("2026-02-30", "2026-03-01")).toBe(false);
		expect(validDateRange("2026-10-30", "2026-10-29")).toBe(false);
		expect(validDateRange("2026-01-01", "2027-02-01")).toBe(false);
		expect(validDateRange("2024-02-29", "2024-03-01")).toBe(true);
	});
	it("preserves the comparison period and grain on view switches but resets page and detail", () => {
		const previous = { from: "2026-10-01", to: "2026-10-29", grain: "month" as const, page: 3, detail: "/old" };
		const next = { ...previous, ...scopeChange({ viewId: "new", conditions: undefined }) };
		expect(next).toMatchObject({
			from: previous.from,
			to: previous.to,
			grain: "month",
			viewId: "new",
			page: undefined,
			detail: undefined,
		});
	});
	it("keeps zero-denominator ratios unknown and preferences user-brand scoped", () => {
		expect(ratio(0, 0)).toBeNull();
		expect(ratio(5, 100)).toBe(5);
		expect(viewStorageKey("u1", "b1")).not.toBe(viewStorageKey("u2", "b1"));
		expect(viewStorageKey("u1", "b1")).not.toBe(viewStorageKey("u1", "b2"));
	});
});

describe("saved-view ordering within a website", () => {
	it("sends every current-site ID exactly once and excludes old-site definitions", () => {
		const views = [
			{ ...view, id: "old", hostname: "old.example.com" },
			{ ...view, id: "first" },
			{ ...view, id: "old-two", hostname: "old.example.com" },
			{ ...view, id: "second" },
		];
		expect(reorderSiteViewIds(views, "example.com", "second", -1)).toEqual(["second", "first"]);
		expect(reorderSiteViewIds(views, "example.com", "first", 1)).toEqual(["second", "first"]);
		expect(reorderSiteViewIds(views, "example.com", "old", -1)).toEqual(["first", "second"]);
		expect(reorderSiteViewIds(views, "example.com", "first", -1)).toEqual(["first", "second"]);
	});
});

describe("copying a saved view to the current website", () => {
	it("creates editable conditions without carrying old identity or mutating the original", () => {
		const original = { ...view, hostname: "old.example.com" };
		const draft = duplicateViewDraft(original, "Home copy");
		expect(draft).not.toHaveProperty("id");
		expect(draft).not.toHaveProperty("revision");
		expect(draft).not.toHaveProperty("hostname");
		expect(draft.conditions).toEqual(original.conditions);
		draft.conditions[0].value = "/new";
		expect(original.conditions[0].value).toBe("/");
	});
});
