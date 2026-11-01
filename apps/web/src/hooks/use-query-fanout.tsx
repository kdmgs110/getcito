import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { APP_TIMEZONE } from "@/lib/app-locale";
import type { LookbackPeriod } from "@/lib/chart-utils";
import { getQueryFanoutFn } from "@/server/query-fanout";

export interface QueryFanoutFilters {
	lookback?: LookbackPeriod;
	model?: string;
	/** Tag filter (resolved to prompt IDs server-side, like Share of Voice). */
	tags?: string[];
	/** Scope to one prompt (prompt-details Web Queries tab) — lists come back uncapped. */
	promptId?: string;
	language?: string;
}

export const queryFanoutKeys = {
	all: ["query-fanout"] as const,
	list: (brandId: string, filters?: QueryFanoutFilters) => [...queryFanoutKeys.all, brandId, filters] as const,
};

export function useQueryFanout(brandId?: string, filters?: QueryFanoutFilters) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const query = useQuery({
		queryKey: queryFanoutKeys.list(resolvedBrandId || "", filters),
		queryFn: () =>
			getQueryFanoutFn({
				data: {
					brandId: resolvedBrandId!,
					lookback: filters?.lookback ?? "1m",
					model: filters?.model,
					tags: filters?.tags?.join(","),
					promptId: filters?.promptId,
					language: filters?.language,
					timezone: APP_TIMEZONE,
				},
			}),
		enabled: !!resolvedBrandId,
		staleTime: 30_000,
		placeholderData: (prev, previousQuery) =>
			(previousQuery?.queryKey[2] as QueryFanoutFilters | undefined)?.language === filters?.language &&
			(previousQuery?.queryKey[2] as QueryFanoutFilters | undefined)?.model === filters?.model &&
			previousQuery?.queryKey[1] === resolvedBrandId
				? prev
				: undefined,
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		isError: !!query.error,
		revalidate: query.refetch,
	};
}
