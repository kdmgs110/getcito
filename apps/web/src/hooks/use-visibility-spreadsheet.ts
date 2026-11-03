import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { LookbackPeriod } from "@/lib/chart-utils";
import { SPREADSHEET_BATCH_SIZE } from "@/lib/visibility-spreadsheet";
import { getVisibilitySpreadsheetRowsFn } from "@/server/visibility-spreadsheet";

/** Fetch only the visible batch of answers, not every provider payload at once. */
export function useVisibilitySpreadsheet({
	brandId,
	promptIds,
	lookback,
	enabled = true,
}: {
	brandId?: string;
	promptIds: string[];
	lookback: LookbackPeriod;
	enabled?: boolean;
}) {
	const query = useInfiniteQuery({
		queryKey: ["visibility-spreadsheet", brandId, lookback, promptIds],
		initialPageParam: {
			offset: 0,
			asOf: undefined as string | undefined,
			mentionRevision: undefined as string | undefined,
		},
		queryFn: async ({ pageParam }) => {
			if (!brandId) throw new Error("Brand is required");
			const response = await getVisibilitySpreadsheetRowsFn({
				data: {
					brandId,
					lookback,
					promptIds: promptIds.slice(pageParam.offset, pageParam.offset + SPREADSHEET_BATCH_SIZE),
					asOf: pageParam.asOf,
				},
			});
			if (pageParam.mentionRevision !== undefined && pageParam.mentionRevision !== response.mentionRevision)
				throw new Error("Mention definitions changed while loading");
			return { ...response, nextOffset: pageParam.offset + SPREADSHEET_BATCH_SIZE };
		},
		getNextPageParam: (page) =>
			page.nextOffset < promptIds.length
				? { offset: page.nextOffset, asOf: page.asOf, mentionRevision: page.mentionRevision }
				: undefined,
		enabled: enabled && !!brandId && promptIds.length > 0,
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	});
	const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data]);
	return {
		rows,
		asOf: query.data?.pages[0]?.asOf,
		mentionRevision: query.data?.pages[0]?.mentionRevision,
		totalCount: promptIds.length,
		loadedCount: Math.min(query.data?.pages.at(-1)?.nextOffset ?? 0, promptIds.length),
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isLoading: query.isLoading,
		isFetchingNextPage: query.isFetchingNextPage,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
}
