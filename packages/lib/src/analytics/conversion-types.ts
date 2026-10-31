import type { AIProvider, TrafficGrain, TrafficRequest } from "./types";
export interface GA4KeyEvent {
	name: string;
	eventName: string;
	createTime: string | null;
	countingMethod: string;
}
export interface ConversionGoal {
	id: string;
	brandId: string;
	propertyId: string;
	hostname: string;
	eventName: string;
	displayName: string;
	enabled: boolean;
	revision: number;
	ga4Name: string;
	ga4CreateTime: string | null;
	countingMethod: string;
	updatedAt: string;
}
export interface ConversionMetrics {
	cv: number;
	aiCv: number;
	sessions: number | null;
	aiSessions: number | null;
	cvSessions: number | null;
	aiCvSessions: number | null;
	/** Fractions in [0,1]. */
	cvr: number | null;
	aiCvr: number | null;
}
export interface ConversionPeriod extends ConversionMetrics {
	date: string;
	providers: Record<AIProvider, number>;
}
export interface ConversionSourceRow {
	provider: AIProvider;
	sessions: number | null;
	cv: number;
	cvSessions: number | null;
	cvr: number | null;
}
export interface ConversionPageRow extends ConversionMetrics {
	path: string;
	/** Observed page-view metadata; CV counts remain grouped by landing path. */
	pageIdentities?: { hostname: string; title: string | null }[];
	trend: ConversionPeriod[];
}
export interface ConversionReport {
	totals: ConversionMetrics;
	points: ConversionPeriod[];
	sources: ConversionSourceRow[];
	pages: { rows: ConversionPageRow[]; totalRows: number; page: number; pageSize: number };
	measurementScope: "landing_sessions" | "cv_event_host";
	pageAttributionSupported: boolean;
	cvrSupported: boolean;
	warnings: string[];
	fetchedAt: string;
	timeZone: string;
}
export interface ConversionRequest extends TrafficRequest {
	goalId: string;
	grain: TrafficGrain;
	page?: number;
	pageSize?: number;
	pageSearch?: string;
	detail?: string;
}
