import type { SavedTrafficView, TrafficCondition, TrafficGrain } from "@workspace/lib/analytics";

export interface TrafficSearch {
	viewId?: string;
	analysisTab?: "traffic" | "conversions";
	conversionGoalId?: string;
	from?: string;
	to?: string;
	grain?: TrafficGrain;
	chart?: "total" | "sources";
	conditions?: string;
	detail?: string;
	page?: number;
	pageSize?: 5 | 10 | 25 | 50;
	pageSearch?: string;
	pageScope?: "ai" | "all";
	ga4?: "connected" | "error";
}
export function parseConditions(value: unknown): TrafficCondition[] | null {
	if (typeof value !== "string" || value.length > 20000) return null;
	try {
		const rows: unknown = JSON.parse(value);
		if (!Array.isArray(rows) || rows.length > 20) return null;
		if (
			!rows.every(
				(row) =>
					row &&
					typeof row === "object" &&
					["include", "exclude"].includes(row.mode) &&
					["exact", "subtree", "contains", "regex"].includes(row.operator) &&
					typeof row.value === "string" &&
					row.value.length <= 2000,
			)
		)
			return null;
		return rows.map(({ mode, operator, value }) => ({ mode, operator, value }));
	} catch {
		return null;
	}
}
export function validateTrafficSearch(search: Record<string, unknown>): TrafficSearch {
	const output: TrafficSearch = {};
	for (const key of ["viewId", "from", "to", "detail", "pageSearch", "conversionGoalId"] as const) {
		if (typeof search[key] === "string" && search[key].length <= 2000) output[key] = search[key];
	}
	if (typeof search.conditions === "string" && parseConditions(search.conditions))
		output.conditions = search.conditions;
	if (["day", "week", "month"].includes(String(search.grain))) output.grain = search.grain as TrafficGrain;
	if (["total", "sources"].includes(String(search.chart))) output.chart = search.chart as "total" | "sources";
	if (["ai", "all"].includes(String(search.pageScope))) output.pageScope = search.pageScope as "ai" | "all";
	if (search.analysisTab === "traffic" || search.analysisTab === "conversions") output.analysisTab = search.analysisTab;
	const page = Number(search.page);
	if (Number.isSafeInteger(page) && page > 0 && page <= 100000) output.page = page;
	const pageSize = Number(search.pageSize);
	if ([5, 10, 25, 50].includes(pageSize)) output.pageSize = pageSize as 5 | 10 | 25 | 50;
	if (search.ga4 === "connected" || search.ga4 === "error") output.ga4 = search.ga4;
	return output;
}
export function validDateRange(from: string, to: string): boolean {
	const valid = (date: string) =>
		/^\d{4}-\d{2}-\d{2}$/.test(date) &&
		Number.isFinite(Date.parse(date)) &&
		new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
	if (!valid(from) || !valid(to)) return false;
	const days = (Date.parse(to) - Date.parse(from)) / 86400000;
	return days >= 0 && days < 366;
}
export function sameConditions(a: TrafficCondition[], b: TrafficCondition[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
export function resolveViewConditions(
	search: TrafficSearch,
	views: SavedTrafficView[],
	hostname: string,
): { view?: SavedTrafficView; conditions: TrafficCondition[]; invalidView: boolean } {
	const view = views.find((v) => v.id === search.viewId && v.hostname === hostname);
	return {
		view,
		conditions: parseConditions(search.conditions) ?? view?.conditions ?? [],
		invalidView: !!search.viewId && !view,
	};
}
export function ratio(ai: number, total: number): number | null {
	return total > 0 ? (ai / total) * 100 : null;
}
export function viewStorageKey(userId: string, brandId: string) {
	return `getcito:traffic-view:${encodeURIComponent(userId)}:${encodeURIComponent(brandId)}`;
}
export function scopeChange(patch: Partial<TrafficSearch>): Partial<TrafficSearch> {
	return { ...patch, page: undefined, pageSearch: undefined, detail: undefined };
}

export function reorderSiteViewIds(
	views: SavedTrafficView[],
	hostname: string,
	id: string,
	direction: number,
): string[] {
	const ids = views.filter((view) => view.hostname === hostname).map((view) => view.id);
	const index = ids.indexOf(id);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= ids.length) return ids;
	[ids[index], ids[target]] = [ids[target], ids[index]];
	return ids;
}

export function duplicateViewDraft(
	view: SavedTrafficView,
	name: string,
): Pick<SavedTrafficView, "name" | "conditions" | "analysisTab" | "conversionGoalId"> {
	return {
		name: name.slice(0, 60),
		conditions: view.conditions.map((condition) => ({ ...condition })),
		analysisTab: view.analysisTab,
		conversionGoalId: view.conversionGoalId,
	};
}

export function newViewDraft(
	conditions: TrafficCondition[],
	analysisTab: "traffic" | "conversions",
	conversionGoalId?: string,
) {
	return {
		name: "",
		conditions: conditions.map((condition) => ({ ...condition })),
		analysisTab,
		conversionGoalId: conversionGoalId ?? null,
	};
}
