import { RE2JS } from "re2js";
import { z } from "zod";
import type { AnalyticsMeasurementMode, TrafficCondition } from "./types";

export const FILTER_SCHEMA_VERSION = 1;
export const ANALYTICS_MEASUREMENT_VERSION = 1;
export function trafficPathDimension(mode: AnalyticsMeasurementMode = "landing_sessions"): "landingPage" | "pagePath" {
	return mode === "observed_session_start" ? "pagePath" : "landingPage";
}
export const trafficConditionSchema = z.object({
	mode: z.enum(["include", "exclude"]),
	operator: z.enum(["exact", "subtree", "contains", "regex"]),
	value: z.string().trim().min(1).max(1000),
});
export const trafficConditionsSchema = z.array(trafficConditionSchema).max(20);
const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((s) => {
		const d = new Date(`${s}T00:00:00Z`);
		return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
	}, "Invalid calendar date");
export const trafficRequestSchema = z
	.object({
		brandId: z.string().min(1).max(200),
		from: isoDate,
		to: isoDate,
		conditions: trafficConditionsSchema.default([]),
	})
	.refine((v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < 366, {
		message: "Select a valid range of at most 366 days",
		path: ["to"],
	});
export const trafficPagesRequestSchema = trafficRequestSchema.safeExtend({
	page: z.number().int().min(1).max(100_000).default(1),
	pageSize: z.union([z.literal(5), z.literal(10), z.literal(25), z.literal(50)]).default(10),
	pageSearch: z.string().trim().max(300).default(""),
	pageScope: z.enum(["ai", "all"]).default("ai"),
});
// Backwards-friendly shorthand for callers using the planning terminology.
export const trafficPagesSchema = trafficPagesRequestSchema;

export function normalizeHostname(value: string): string {
	const url = new URL(value.includes("://") ? value : `https://${value}`);
	if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || !url.hostname || url.port) {
		throw new Error("Invalid website hostname");
	}
	return url.hostname.toLowerCase().replace(/\.$/, "");
}

export function validateTrafficRegex(value: string): void {
	if (!value || value.length > 1000) throw new Error("Invalid traffic regular expression");
	try {
		// RE2 syntax only, with no JavaScript backtracking or lookbehind extensions.
		RE2JS.compile(value);
	} catch {
		throw new Error("Invalid RE2 regular expression");
	}
}

export function normalizeConditions(conditions: TrafficCondition[], hostname: string): TrafficCondition[] {
	const site = normalizeHostname(hostname);
	const parsed = trafficConditionsSchema.parse(conditions);
	return parsed.map((condition) => {
		let value = condition.value;
		if (condition.operator === "regex") {
			validateTrafficRegex(value);
		} else {
			if (/^https?:\/\//i.test(value)) {
				const url = new URL(value);
				if (normalizeHostname(url.hostname) !== site || url.port || url.username || url.password) {
					throw new Error("URL must belong to the selected website");
				}
				value = url.pathname;
			} else {
				if (
					!value.startsWith("/") ||
					value.startsWith("//") ||
					Array.from(value).some((character) => character.charCodeAt(0) < 32)
				) {
					throw new Error("Enter a URL or a path beginning with /");
				}
				// Split only literal delimiters: %2F and escaped path bytes stay intact.
				value = value.split(/[?#]/, 1)[0];
			}
			if (condition.operator === "subtree" && value !== "/") value = value.replace(/\/+$/, "");
		}
		return { ...condition, value };
	});
}

export interface GAFilterExpression {
	andGroup?: { expressions: GAFilterExpression[] };
	orGroup?: { expressions: GAFilterExpression[] };
	notExpression?: GAFilterExpression;
	filter?: {
		fieldName: string;
		stringFilter?: { matchType: "EXACT" | "CONTAINS" | "FULL_REGEXP"; value: string; caseSensitive: boolean };
		inListFilter?: { values: string[]; caseSensitive: boolean };
	};
}
export function stringFilter(
	fieldName: string,
	value: string,
	matchType: "EXACT" | "CONTAINS" | "FULL_REGEXP" = "EXACT",
	caseSensitive = true,
): GAFilterExpression {
	return { filter: { fieldName, stringFilter: { matchType, value, caseSensitive } } };
}
export function andFilters(...expressions: (GAFilterExpression | undefined)[]): GAFilterExpression {
	const existing = expressions.filter((e): e is GAFilterExpression => !!e);
	return existing.length === 1 ? existing[0] : { andGroup: { expressions: existing } };
}
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function buildPathFilter(
	conditions: TrafficCondition[],
	fieldName: "landingPage" | "pagePath" = "landingPage",
): GAFilterExpression | undefined {
	if (conditions.length === 0) return undefined;
	return andFilters(
		...conditions.map((condition) => {
			let match: GAFilterExpression;
			if (condition.operator === "subtree") {
				const base = condition.value === "/" ? "" : condition.value.replace(/\/+$/, "");
				match = stringFilter(fieldName, base ? `^${escapeRegex(base)}(/.*)?$` : "^/.*$", "FULL_REGEXP");
			} else {
				match = stringFilter(
					fieldName,
					condition.value,
					condition.operator === "exact" ? "EXACT" : condition.operator === "contains" ? "CONTAINS" : "FULL_REGEXP",
				);
			}
			return condition.mode === "exclude" ? { notExpression: match } : match;
		}),
	);
}
