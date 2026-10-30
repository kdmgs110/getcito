import { createHash } from "node:crypto";
import {
	AI_CLASSIFICATION_VERSION,
	type AnalyticsMeasurementMode,
	CONVERSION_MEASUREMENT_VERSION,
	type ConversionRequest,
	FILTER_SCHEMA_VERSION,
	normalizeConditions,
} from "@workspace/lib/analytics";

type CacheConnection = {
	brandId: string;
	revision: string;
	propertyId: string;
	hostname: string;
	hostnames?: string[];
	measurementMode: AnalyticsMeasurementMode;
};
type CacheGoal = { id: string; revision: number };

/** Pure key shared by the endpoint and deterministic report fixtures. */
export function conversionReportCacheKey(
	connection: CacheConnection,
	goal: CacheGoal | CacheGoal[],
	input: ConversionRequest,
): string {
	const hosts = [...new Set(connection.hostnames ?? [connection.hostname])].sort();
	const goals = (Array.isArray(goal) ? goal : [goal])
		.map(({ id, revision }) => ({ id, revision }))
		.sort((a, b) => a.id.localeCompare(b.id));
	const normalized = {
		hostnames: hosts,
		brandId: input.brandId,
		from: input.from,
		to: input.to,
		conditions: normalizeConditions(input.conditions ?? [], hosts),
		goalId: input.goalId,
		grain: input.grain ?? "day",
		page: input.page ?? 1,
		pageSize: input.pageSize ?? 10,
		pageSearch: input.pageSearch?.trim() ?? "",
		detail: input.detail?.trim() ?? "",
	};
	return createHash("sha256")
		.update(
			JSON.stringify([
				"conversion-report-v2",
				AI_CLASSIFICATION_VERSION,
				FILTER_SCHEMA_VERSION,
				CONVERSION_MEASUREMENT_VERSION,
				connection.brandId,
				connection.revision,
				connection.propertyId,
				connection.hostname,
				connection.measurementMode,
				goals,
				normalized,
			]),
		)
		.digest("hex");
}
