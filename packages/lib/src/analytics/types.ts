export const AI_PROVIDERS = ["chatgpt", "perplexity", "gemini", "claude", "copilot", "other"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export type TrafficGrain = "day" | "week" | "month";
export type AnalyticsMeasurementMode = "landing_sessions" | "observed_session_start";
export interface TrafficCondition {
	mode: "include" | "exclude";
	operator: "exact" | "subtree" | "contains" | "regex";
	value: string;
}
export interface TrafficTotals extends Record<AIProvider, number> {
	ai: number;
	total: number;
}
export interface TrafficPoint extends TrafficTotals {
	date: string;
}
export interface TrafficOverview {
	points: TrafficPoint[];
	totals: TrafficTotals;
	warnings: string[];
	fetchedAt: string;
	timeZone: string;
}
export interface TrafficPageRow extends TrafficTotals {
	path: string;
	/** Present for combined reports so identical paths on different hosts stay separate. */
	hostname?: string;
	/** Most frequent page-view title on this host during the selected period. */
	title?: string | null;
	trend: TrafficPoint[];
}
export interface TrafficPages {
	rows: TrafficPageRow[];
	totalRows: number;
	page: number;
	pageSize: number;
	warnings: string[];
	fetchedAt: string;
}
export interface TrafficRequest {
	brandId: string;
	/** Omitted or `all` selects all domains configured for the brand. */
	hostname?: string;
	detailHostname?: string;
	from: string;
	to: string;
	conditions: TrafficCondition[];
}
export interface TrafficPagesRequest extends TrafficRequest {
	page: number;
	pageSize: number;
	pageSearch: string;
	pageScope: "ai" | "all";
}
export interface SavedTrafficView {
	conversionGoalId?: string | null;
	analysisTab?: "traffic" | "conversions";
	id: string;
	brandId: string;
	hostname: string;
	name: string;
	conditions: TrafficCondition[];
	sortOrder: number;
	revision: number;
	updatedAt: string;
}
export interface AnalyticsPropertySummary {
	id: string;
	name: string;
}
export interface AnalyticsProperty extends AnalyticsPropertySummary {
	timeZone: string;
	websites: string[];
}
export interface TrafficConnectionStatus {
	configured: boolean;
	connected: boolean;
	oauthConnected: boolean;
	canManage: boolean;
	needsReconnect: boolean;
	userId: string;
	hostname: string;
	availableSites: string[];
	propertyId: string | null;
	propertyName: string | null;
	connectionRevision: string | null;
	measurementMode?: AnalyticsMeasurementMode;
	timeZone: string;
}
