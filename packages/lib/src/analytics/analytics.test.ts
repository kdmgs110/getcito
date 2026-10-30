import { describe, expect, it } from "vitest";
import { RE2JS } from "re2js";
import { aggregateTrafficPoints, defaultTrafficRange, emptyTrafficTotals } from "./dates";
import { buildAIFilter, classifyAISource } from "./classification";
import {
	buildPathFilter,
	normalizeConditions,
	trafficRequestSchema,
	trafficPagesRequestSchema,
	trafficPathDimension,
	validateTrafficRegex,
} from "./filters";
import type { TrafficCondition, TrafficPoint } from "./types";

const condition = (
	value: string,
	operator: TrafficCondition["operator"] = "exact",
	mode: TrafficCondition["mode"] = "include",
): TrafficCondition => ({ value, operator, mode });
describe("traffic URL conditions", () => {
	it("normalizes same-site absolute URLs without decoding path bytes", () => {
		expect(normalizeConditions([condition("http://example.com/job%2F123/?utm_source=ai#test")], "example.com")).toEqual(
			[condition("/job%2F123/")],
		);
	});
	it("rejects other hosts, credentials and scheme-relative URLs", () => {
		for (const value of [
			"https://example.com.evil.org/jobs",
			"https://user:password@example.com/jobs",
			"//evil.org/jobs",
			"jobs",
			"https://example.com:444/jobs",
		]) {
			expect(() => normalizeConditions([condition(value)], "example.com")).toThrow();
		}
	});
	it("keeps exact case and trailing slash, while removing query and fragment", () => {
		expect(normalizeConditions([condition("/Jobs/?x=y#here"), condition("/jobs")], "example.com")).toEqual([
			condition("/Jobs/"),
			condition("/jobs"),
		]);
	});
	it("uses directory boundaries and does not match a similarly named path", () => {
		const filter = buildPathFilter(normalizeConditions([condition("/job_listings/", "subtree")], "example.com"));
		const expression = filter?.filter?.stringFilter?.value as string;
		for (const path of ["/job_listings", "/job_listings/", "/job_listings/123"])
			expect(RE2JS.matches(expression, path)).toBe(true);
		for (const path of ["/job_listings-old", "/job_listings2", "/other/job_listings/"])
			expect(RE2JS.matches(expression, path)).toBe(false);
	});
	it("handles root as every actual path, excluding unknown empty values", () => {
		const expression = buildPathFilter([condition("/", "subtree")])?.filter?.stringFilter?.value as string;
		expect(RE2JS.matches(expression, "/")).toBe(true);
		expect(RE2JS.matches(expression, "/jobs/a")).toBe(true);
		expect(RE2JS.matches(expression, "")).toBe(false);
	});
	it("ANDs conditions and wraps exclusion in NOT", () => {
		const filter = buildPathFilter([
			condition("/jobs/", "contains"),
			condition("^/jobs/private/.*$", "regex", "exclude"),
		]);
		expect(filter?.andGroup?.expressions).toHaveLength(2);
		expect(filter?.andGroup?.expressions[1].notExpression?.filter?.stringFilter?.matchType).toBe("FULL_REGEXP");
	});
	it("applies the same boundary and exclusion semantics to observed start event paths", () => {
		expect(trafficPathDimension()).toBe("landingPage");
		expect(trafficPathDimension("observed_session_start")).toBe("pagePath");
		const filter = buildPathFilter(
			[condition("/jobs/", "subtree"), condition("/jobs/private", "contains", "exclude")],
			"pagePath",
		);
		const [include, exclude] = filter?.andGroup?.expressions ?? [];
		expect(include.filter?.fieldName).toBe("pagePath");
		expect(exclude.notExpression?.filter?.fieldName).toBe("pagePath");
		expect(RE2JS.matches(include.filter?.stringFilter?.value ?? "", "/jobs-old")).toBe(false);
	});
	it("rejects backreferences, lookaround and invalid RE2 syntax", () => {
		for (const value of ["(a)\\1", "(?=foo)foo", "(?<=foo)bar", "["])
			expect(() => validateTrafficRegex(value)).toThrow();
		expect(() => validateTrafficRegex("^/(jobs|articles)(/.*)?$")).not.toThrow();
	});
	it("validates actual calendar dates and bounds query cost", () => {
		expect(
			trafficRequestSchema.safeParse({ brandId: "b", from: "2026-02-30", to: "2026-03-01", conditions: [] }).success,
		).toBe(false);
		expect(
			trafficRequestSchema.safeParse({ brandId: "b", from: "2026-03-02", to: "2026-03-01", conditions: [] }).success,
		).toBe(false);
		expect(
			trafficRequestSchema.safeParse({ brandId: "b", from: "2025-01-01", to: "2026-03-01", conditions: [] }).success,
		).toBe(false);
		expect(trafficPagesRequestSchema.parse({ brandId: "b", from: "2026-01-01", to: "2026-03-01" })).toMatchObject({
			page: 1,
			pageSize: 10,
			pageScope: "ai",
			conditions: [],
		});
	});
});
describe("AI source classification", () => {
	it("identifies aliases and subdomains while preventing suffix spoofing", () => {
		expect(classifyAISource("ChatGPT (OpenAI)")).toBe("chatgpt");
		expect(classifyAISource("www.perplexity.ai")).toBe("perplexity");
		expect(classifyAISource("chatgpt.com.evil.org")).toBeNull();
		expect(classifyAISource("notchatgpt.com")).toBeNull();
	});
	it("keeps search, direct and unrelated AI-looking strings out", () => {
		for (const source of ["bing.com", "google.com", "(direct)", "affiliate.ai", "openai.com", "copilot.com"])
			expect(classifyAISource(source)).toBeNull();
	});
	it("includes historical referrers and native AI's unknown providers", () => {
		expect(classifyAISource("chat.openai.com", "referral")).toBe("chatgpt");
		expect(classifyAISource("unrecognized.example", "ai-assistant")).toBe("other");
		expect(classifyAISource("unrecognized.example", "referral", "AI Assistant")).toBe("other");
	});
	it("builds one union filter so native and legacy matches cannot double count", () => {
		const filter = buildAIFilter();
		expect(filter.orGroup?.expressions).toHaveLength(3);
		const sourceFilter = filter.orGroup?.expressions[2].filter?.stringFilter;
		expect(RE2JS.compile(sourceFilter?.value ?? "", RE2JS.CASE_INSENSITIVE).matches("CHATGPT.COM")).toBe(true);
		expect(RE2JS.compile(sourceFilter?.value ?? "").matches("chatgpt.com.evil.org")).toBe(false);
	});
});
describe("property-calendar aggregation", () => {
	it("uses property yesterday rather than host timezone and survives DST", () => {
		expect(defaultTrafficRange("Asia/Tokyo", new Date("2026-10-29T23:00:00Z"))).toEqual({
			from: "2026-10-02",
			to: "2026-10-29",
		});
		expect(defaultTrafficRange("America/Los_Angeles", new Date("2026-10-29T23:00:00Z"))).toEqual({
			from: "2026-10-01",
			to: "2026-10-28",
		});
		expect(defaultTrafficRange("America/New_York", new Date("2026-03-09T12:00:00Z"))).toEqual({
			from: "2026-02-09",
			to: "2026-03-08",
		});
	});
	it("uses ISO Monday weeks across years and does not drop partial periods", () => {
		const points: TrafficPoint[] = ["2025-12-31", "2026-01-01", "2026-01-05"].map((date) => ({
			date,
			...emptyTrafficTotals(),
			ai: 1,
			total: 4,
			chatgpt: 1,
		}));
		expect(aggregateTrafficPoints(points, "week").map(({ date, ai }) => ({ date, ai }))).toEqual([
			{ date: "2025-12-29", ai: 2 },
			{ date: "2026-01-05", ai: 1 },
		]);
		expect(aggregateTrafficPoints(points, "month").map(({ date, ai }) => ({ date, ai }))).toEqual([
			{ date: "2025-12-01", ai: 1 },
			{ date: "2026-01-01", ai: 2 },
		]);
		expect(aggregateTrafficPoints(points, "week", "2026-01-01", "2026-01-04")[0].ai).toBe(1);
	});
});
