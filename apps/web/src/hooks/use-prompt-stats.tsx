import { useQuery } from "@tanstack/react-query";
import { getPromptStatsFn } from "@/server/prompts";

export const promptStatsKeys = {
	all: ["prompt-stats"] as const,
	detail: (promptId: string, days: number, endDate?: string, language = "all") =>
		[...promptStatsKeys.all, promptId, days, endDate ?? null, language] as const,
};

export function usePromptStats(promptId?: string, options?: { days?: number; endDate?: string; language?: string }) {
	const days = options?.days || 7;
	const endDate = options?.endDate;
	const language = options?.language ?? "all";

	const query = useQuery({
		queryKey: promptStatsKeys.detail(promptId || "", days, endDate, language),
		queryFn: () => getPromptStatsFn({ data: { promptId: promptId!, days, endDate, language } }),
		enabled: !!promptId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		// A changed language must never show cached totals from the previous selection.
	});

	return {
		data: query.data,
		promptStats: query.data,
		isLoading: query.isLoading,
		isError: query.error,
		revalidate: query.refetch,
		// Convenience accessors (match Next.js hook)
		prompt: query.data?.prompt,
		aggregations: query.data?.aggregations,
	};
}
