import { z } from "zod";
import type { ConversionMetrics, ConversionPeriod } from "./conversion-types";
import { trafficRequestSchema } from "./filters";
import { AI_PROVIDERS } from "./types";
export const CONVERSION_MEASUREMENT_VERSION = 4;
export const conversionEventNameSchema = z
	.string()
	.min(1)
	.max(40)
	.refine(
		(value) => !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
		"Invalid event name",
	);
export const conversionRequestSchema = trafficRequestSchema.safeExtend({
	goalId: z.union([z.uuid(), z.literal("all")]),
	grain: z.enum(["day", "week", "month"]).default("day"),
	page: z.number().int().min(1).max(100000).default(1),
	pageSize: z.union([z.literal(5), z.literal(10), z.literal(25), z.literal(50)]).default(10),
	pageSearch: z.string().trim().max(300).default(""),
	detail: z.string().min(1).max(2048).optional(),
});
export function emptyConversionMetrics(): ConversionMetrics {
	return {
		cv: 0,
		aiCv: 0,
		sessions: null,
		aiSessions: null,
		cvSessions: null,
		aiCvSessions: null,
		cvr: null,
		aiCvr: null,
	};
}
export function emptyConversionPeriod(date: string): ConversionPeriod {
	return {
		date,
		...emptyConversionMetrics(),
		providers: Object.fromEntries(AI_PROVIDERS.map((key) => [key, 0])) as ConversionPeriod["providers"],
	};
}
