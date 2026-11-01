import { useQuery } from "@tanstack/react-query";
import { getPromptRunsFn } from "@/server/prompts";

export const promptRunsKeys = {
	all: ["prompt-runs"] as const,
	list: (
		promptId: string,
		options: { page: number; limit: number; days: number; endDate?: string; language?: string; model?: string },
	) => [...promptRunsKeys.all, promptId, options] as const,
};

export function usePromptRunsOnly(
	promptId?: string,
	options?: { page?: number; limit?: number; days?: number; endDate?: string; language?: string; model?: string },
) {
	const page = options?.page || 1;
	const limit = options?.limit || 10;
	const days = options?.days || 7;
	const endDate = options?.endDate;
	const language = options?.language ?? "all";
	const model = options?.model === "all" ? undefined : options?.model;

	const query = useQuery({
		queryKey: promptRunsKeys.list(promptId || "", { page, limit, days, endDate, language, model }),
		queryFn: () => getPromptRunsFn({ data: { promptId: promptId!, page, limit, days, endDate, language, model } }),
		enabled: !!promptId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		// Do not render data from a different language while the new request loads.
	});

	const total = Number(query.data?.total || 0);
	const totalPages = Math.ceil(total / limit) || 1;

	return {
		runs: query.data?.runs || [],
		total,
		hasMore: query.data?.hasMore || false,
		isLoading: query.isLoading,
		isError: query.error,
		revalidate: query.refetch,
		// Pagination object matching Next.js hook shape
		pagination: query.data
			? {
					page,
					limit,
					total,
					totalPages,
					hasNext: page < totalPages,
					hasPrev: page > 1,
				}
			: undefined,
	};
}
