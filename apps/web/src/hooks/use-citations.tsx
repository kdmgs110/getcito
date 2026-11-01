import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getCitationsFn } from "@/server/citations";

export interface CitationFilters {
	days?: number;
	/** Last day of the window (`YYYY-MM-DD`); omit for a window ending today. */
	endDate?: string;
	tags?: string[];
	model?: string;
}

export const citationKeys = {
	all: ["citations"] as const,
	list: (brandId: string, filters?: CitationFilters) => [...citationKeys.all, brandId, filters] as const,
};

export function useCitations(brandId?: string, filters?: CitationFilters) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const query = useQuery({
		queryKey: citationKeys.list(resolvedBrandId || "", filters),
		queryFn: () =>
			getCitationsFn({
				data: {
					brandId: resolvedBrandId!,
					days: filters?.days || 7,
					endDate: filters?.endDate,
					tags: filters?.tags?.join(","),
					model: filters?.model,
				},
			}),
		enabled: !!resolvedBrandId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		refetchInterval: 60_000,
	});

	return {
		citations: query.data,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		isError: query.error,
		revalidate: query.refetch,
	};
}
