import { z } from "zod";

import { AI_QUESTION_REGEX } from "./ai-question";

export type { AiQuestionReason } from "./ai-question";
export { AI_QUESTION_REGEX, AI_QUESTION_RULES, getAiQuestionSignals, LONG_JAPANESE_QUERY_REGEX } from "./ai-question";
export const GSC_FILTER_VERSION = 2;
const DAY = 86_400_000;

/** Search Console dates are calendar dates in Pacific Time, including DST. */
export function searchConsoleToday(now = new Date()): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Los_Angeles",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	return ["year", "month", "day"].map((kind) => parts.find((part) => part.type === kind)?.value).join("-");
}

export function defaultSearchConsoleDates(now = new Date()): { startDate: string; endDate: string } {
	const today = Date.parse(`${searchConsoleToday(now)}T00:00:00Z`);
	return {
		startDate: new Date(today - 30 * DAY).toISOString().slice(0, 10),
		endDate: new Date(today - 3 * DAY).toISOString().slice(0, 10),
	};
}

function validDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function fullPageUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
	} catch {
		return false;
	}
}

export const urlConditionSchema = z
	.object({
		operator: z.enum(["contains", "notContains", "equals", "subtree"]),
		value: z
			.string()
			.trim()
			.min(1)
			.max(2048)
			.refine(
				(value) => !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
				"GSC_INVALID_FILTER",
			),
	})
	.superRefine((condition, ctx) => {
		if ((condition.operator === "equals" || condition.operator === "subtree") && !fullPageUrl(condition.value))
			ctx.addIssue({ code: "custom", path: ["value"], message: "GSC_INVALID_FILTER" });
		if (condition.operator === "subtree" && fullPageUrl(condition.value) && new URL(condition.value).search)
			ctx.addIssue({ code: "custom", path: ["value"], message: "GSC_INVALID_FILTER" });
	});

export const reportFiltersSchema = z
	.object({
		startDate: z.string().refine(validDate, "GSC_INVALID_FILTER"),
		endDate: z.string().refine(validDate, "GSC_INVALID_FILTER"),
		keyword: z.string().trim().max(256).default(""),
		aiQuestionsOnly: z.boolean().default(false),
		urlConditions: z.array(urlConditionSchema).max(10).default([]),
	})
	.superRefine((filters, ctx) => {
		if (!validDate(filters.startDate) || !validDate(filters.endDate)) return;
		const today = searchConsoleToday();
		const date = new Date(`${today}T00:00:00Z`);
		const day = date.getUTCDate();
		date.setUTCDate(1);
		date.setUTCMonth(date.getUTCMonth() - 16);
		const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
		date.setUTCDate(Math.min(day, lastDay));
		if (
			filters.startDate > filters.endDate ||
			filters.endDate >= today ||
			filters.startDate < date.toISOString().slice(0, 10)
		)
			ctx.addIssue({ code: "custom", path: ["startDate"], message: "GSC_INVALID_FILTER" });
	});

export type UrlCondition = z.infer<typeof urlConditionSchema>;
export type SearchConsoleFilters = z.infer<typeof reportFiltersSchema>;
export type GscMetrics = { clicks: number; impressions: number; ctr: number; position: number };
export type GscRow = GscMetrics & { query: string };
export type GscReport = { rows: GscRow[]; totals: GscMetrics; fetchedAt: string; truncated: boolean };
export type GscSite = { siteUrl: string; permissionLevel: string };

function normalizedHost(host: string): string | null {
	try {
		const url = new URL(`https://${host}`);
		if (
			url.host !== host.toLowerCase() ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			url.port ||
			url.username ||
			url.password
		)
			return null;
		return url.hostname;
	} catch {
		return null;
	}
}

/** A domain property can cover a brand host. Other hosts still require report-time scope. */
export function propertyMatchesHosts(siteUrl: string, allowedHostnames: string[]): boolean {
	const hosts = allowedHostnames.map(normalizedHost).filter((host): host is string => host !== null);
	if (siteUrl.startsWith("sc-domain:")) {
		const domain = normalizedHost(siteUrl.slice(10));
		return !!domain && hosts.some((host) => host === domain || host.endsWith(`.${domain}`));
	}
	try {
		const property = new URL(siteUrl);
		return fullPageUrl(siteUrl) && !property.search && !property.port && hosts.includes(property.hostname);
	} catch {
		return false;
	}
}

export function escapeGscRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type GscDimensionFilter = {
	dimension: "page" | "query";
	operator: "contains" | "notContains" | "equals" | "includingRegex";
	expression: string;
};

export function buildSearchConsoleFilters(
	allowedHostnames: string[],
	filters: SearchConsoleFilters,
): GscDimensionFilter[] {
	const hosts = [
		...new Set(allowedHostnames.map(normalizedHost).filter((host): host is string => host !== null)),
	].sort();
	if (!hosts.length) throw new Error("GSC_PROPERTY_FORBIDDEN");
	const expression = `^https?://(${hosts.map(escapeGscRegex).join("|")})(/|$)`;
	if (expression.length > 4096) throw new Error("GSC_INVALID_FILTER");
	const result: GscDimensionFilter[] = [{ dimension: "page", operator: "includingRegex", expression }];
	if (filters.keyword) result.push({ dimension: "query", operator: "contains", expression: filters.keyword });
	if (filters.aiQuestionsOnly)
		result.push({ dimension: "query", operator: "includingRegex", expression: AI_QUESTION_REGEX });
	for (const condition of filters.urlConditions) {
		if (condition.operator === "subtree") {
			const url = new URL(condition.value);
			const path = url.pathname.replace(/\/+$/, "");
			const prefix = `${url.origin}${path}`;
			result.push({ dimension: "page", operator: "includingRegex", expression: `^${escapeGscRegex(prefix)}(/|[?]|$)` });
		} else result.push({ dimension: "page", operator: condition.operator, expression: condition.value });
	}
	if (result.some((filter) => filter.expression.length > 4096)) throw new Error("GSC_INVALID_FILTER");
	return result;
}
