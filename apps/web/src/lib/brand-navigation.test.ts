import { describe, expect, it } from "vitest";
import { brandDomain, getBrandSection, makeBrandDestination, validateBrandReturnSearch } from "./brand-navigation";

describe("brand navigation", () => {
	it("preserves portable traffic preferences and clears every brand-specific selection", () => {
		const next = makeBrandDestination("other", "traffic", {
			from: "2026-10-01",
			to: "2026-10-20",
			grain: "week",
			chart: "sources",
			analysisTab: "conversions",
			viewId: "old-view",
			conversionGoalId: "old-goal",
			detail: "/private",
			conditions: "[]",
			page: 3,
			pageSearch: "old",
			model: "old",
			tags: "old",
			q: "old",
			ga4: "connected",
		});
		expect(next).toEqual({
			to: "/app/$brand/traffic",
			params: { brand: "other" },
			search: {
				from: "2026-10-01",
				to: "2026-10-20",
				grain: "week",
				chart: "sources",
				analysisTab: "conversions",
			},
		});
	});
	it("rejects malformed or reversed date ranges and invalid preferences", () => {
		expect(
			makeBrandDestination("other", "traffic", {
				from: "2026-02-30",
				to: "2026-03-01",
				grain: "bad",
				chart: "bad",
				analysisTab: "bad",
			}).search,
		).toEqual({});
		expect(makeBrandDestination("other", "traffic", { from: "2026-10-20", to: "2026-10-01" }).search).toEqual({});
	});
	it("keeps settings and traffic usable without AI onboarding, and falls back for AI analysis", () => {
		expect(makeBrandDestination("new", "traffic", {}, false).to).toBe("/app/$brand/traffic");
		expect(makeBrandDestination("new", "settings/brand", {}, false).to).toBe("/app/$brand/settings/brand");
		expect(makeBrandDestination("new", "visibility", {}, false).to).toBe("/app/$brand");
	});
	it("does not carry traffic or prompt search into another section", () => {
		expect(
			makeBrandDestination("other", "settings/prompts", {
				from: "2026-10-01",
				to: "2026-10-20",
				q: "old",
				model: "old",
			}).search,
		).toEqual({});
	});
	it("allows only known internal return sections and safe brand identifiers", () => {
		expect(validateBrandReturnSearch({ returnBrand: "default", returnSection: "traffic" })).toEqual({
			returnBrand: "default",
			returnSection: "traffic",
		});
		expect(validateBrandReturnSearch({ returnBrand: "../../auth", returnSection: "https://evil.example" })).toEqual({
			returnBrand: undefined,
			returnSection: undefined,
		});
		expect(validateBrandReturnSearch({ returnBrand: "", returnSection: "__proto__" })).toEqual({
			returnBrand: undefined,
			returnSection: undefined,
		});
	});
	it("recognizes only the exact current brand path and supported sections", () => {
		expect(getBrandSection("/app/default/traffic", "default")).toBe("traffic");
		expect(getBrandSection("/app/default/settings/brand/", "default")).toBe("settings/brand");
		expect(getBrandSection("/app/default-other/traffic", "default")).toBe("");
		expect(getBrandSection("/app/default/prompts/secret", "default")).toBe("");
	});
	it("displays a domain for URLs while retaining fallback values", () => {
		expect(brandDomain("https://freelance.indieverse.co.jp/job_listings/")).toBe("freelance.indieverse.co.jp");
		expect(brandDomain("example.com/path")).toBe("example.com");
		expect(brandDomain(null)).toBe("");
	});
});
