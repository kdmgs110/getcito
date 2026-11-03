import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MentionRecountStatus } from "@workspace/lib/brand-mention-recount";
import { useEffect, useRef } from "react";
import { getMentionRecountStatusFn } from "@/server/brand-mentions";

export const mentionRecountKey = (brandId: string) => ["brand-mention-recount", brandId] as const;

export function useBrandMentionRecount(brandId: string) {
	const queryClient = useQueryClient();
	const refreshed = useRef<string | null>(null);
	const query = useQuery({
		queryKey: mentionRecountKey(brandId),
		queryFn: () => getMentionRecountStatusFn({ data: { brandId } }),
		staleTime: 5_000,
		refetchInterval: (current) => {
			const status = current.state.data?.status;
			return status === "pending" || status === "running" ? 3_000 : false;
		},
	});
	useEffect(() => {
		if (query.data?.status !== "completed") return;
		const completion = `${brandId}:${query.data.id ?? "completed"}:${query.data.completedAt ?? ""}`;
		if (refreshed.current === completion) return;
		refreshed.current = completion;
		// Some historical prompt queries are keyed only by prompt ID. Refresh read
		// caches together so their old mention counts cannot survive the recount.
		void queryClient.invalidateQueries({ predicate: (cached) => cached.queryKey[0] !== "brand-mention-recount" });
	}, [brandId, query.data, queryClient]);
	return query;
}

export function isMentionRecountActive(status?: MentionRecountStatus["status"]) {
	return status === "pending" || status === "running";
}
