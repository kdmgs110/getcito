import { queryOptions, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { APP_TIMEZONE } from "@/lib/app-locale";
import { getPromptChartDataFn } from "@/server/prompts";

export type { LookbackPeriod } from "@/lib/chart-utils";

import type { LookbackPeriod } from "@/lib/chart-utils";

export interface PromptChartDataFilters {
	lookback?: LookbackPeriod;
	webSearchEnabled?: boolean;
	model?: string;
}

export interface PromptChartDataResponse {
	prompt: {
		id: string;
		value: string;
	};
	chartData: Array<{
		date: string;
		[key: string]: number | string | null;
	}>;
	brand: any;
	competitors: any[];
	totalRuns: number;
	hasVisibilityData: boolean;
	lastBrandVisibility: number | null;
	webQueryMapping: Record<string, string>;
	modelWebQueryMappings: Record<string, Record<string, string>>;
}

export function promptChartQueryOptions(
	resolvedBrandId: string | undefined,
	promptId: string,
	filters?: PromptChartDataFilters,
	enabled: boolean = true,
) {
	return queryOptions({
		queryKey: ["promptChartData", resolvedBrandId, promptId, filters],
		queryFn: () =>
			getPromptChartDataFn({
				data: {
					brandId: resolvedBrandId!,
					promptId,
					lookback: filters?.lookback || "1m",
					webSearchEnabled: filters?.webSearchEnabled?.toString(),
					model: filters?.model,
					timezone: APP_TIMEZONE,
				},
			}),
		enabled: enabled && !!resolvedBrandId,
		staleTime: 60_000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		refetchInterval: 60_000,
		retry: 3,
	});
}

export function usePromptChartData(
	brandId: string | undefined,
	promptId: string,
	filters?: PromptChartDataFilters,
	enabled: boolean = true,
) {
	const params = useParams({ strict: false });
	const resolvedBrandId = brandId || (params && "brand" in params ? (params.brand as string) : undefined);

	const { data, error, isLoading, refetch } = useQuery(
		promptChartQueryOptions(resolvedBrandId, promptId, filters, enabled),
	);

	return {
		chartData: data as PromptChartDataResponse | undefined,
		isLoading,
		isError: error,
		revalidate: refetch,
	};
}
