import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useBrand } from "@/hooks/use-brands";
import { opportunitiesQueryOptions } from "@/lib/opportunities-query";

export { opportunitiesKeys } from "@/lib/opportunities-query";

/**
 * Opportunities AEO report. The server returns a stored report and regenerates it
 * only when the latest is stale, so this is held for the session (staleTime:
 * Infinity, no refetch-on-focus) rather than refetched.
 */
export function useOpportunities(brandId?: string) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const { brand, isLoading: isBrandLoading, isError: brandError } = useBrand(resolvedBrandId);
	const query = useQuery(opportunitiesQueryOptions(resolvedBrandId, brand));

	return {
		data: query.data,
		isLoading: isBrandLoading || query.isLoading,
		isFetching: query.isFetching,
		isError: !!(brandError || query.error),
		revalidate: query.refetch,
	};
}
