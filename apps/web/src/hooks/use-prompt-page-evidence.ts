import { useQuery } from "@tanstack/react-query";
import { APP_TIMEZONE } from "@/lib/app-locale";
import type { LookbackPeriod } from "@/lib/chart-utils";
import { getPromptPageEvidenceFn } from "@/server/prompt-page-evidence";

export interface PromptPageEvidenceFilters {
	promptId: string;
	model?: string;
	lookback?: LookbackPeriod;
	language?: string;
	targetKey?: string;
	scopeKey?: string;
	country?: string;
	attemptId?: string;
	runId?: string;
}
export function usePromptPageEvidence(brandId: string, filters: PromptPageEvidenceFilters) {
	return useQuery({
		queryKey: ["prompt-page-evidence", brandId, filters],
		queryFn: () =>
			getPromptPageEvidenceFn({
				data: {
					brandId,
					...filters,
					lookback: filters.lookback ?? "1m",
					language: filters.language ?? "all",
					timezone: APP_TIMEZONE,
				},
			}),
		enabled: Boolean(brandId && filters.promptId),
		staleTime: 30000,
	});
}
