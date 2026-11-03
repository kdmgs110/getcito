import { processMentionRecount } from "@workspace/lib/brand-mention-recount";
import type { Job } from "pg-boss";

export interface RecountBrandMentionsData {
	brandId: string;
	id: string;
}

export async function recountBrandMentionsJob(jobs: Job<RecountBrandMentionsData>[]): Promise<void> {
	for (const job of jobs) await processMentionRecount(job.data.brandId, job.data.id);
}
