import { FIRST_RUN_JOB_PRIORITY, PROCESS_PROMPT_JOB_POLICY } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { sql } from "drizzle-orm";
import type { ProcessPromptData } from "./process-prompt";

/** Resume paid tasks left behind by a crashed worker before scheduling new paid cycles. */
export async function recoverDataForSeoTasks(
	enqueue: (
		data: ProcessPromptData,
		options: {
			singletonKey: string;
			singletonSeconds: number;
			priority: number;
			retryLimit: number;
			retryDelay: number;
			retryBackoff: boolean;
			expireInSeconds: number;
		},
	) => Promise<unknown>,
	activeTargetKeys?: ReadonlySet<string>,
): Promise<Set<string>> {
	if (activeTargetKeys && !activeTargetKeys.has("chatgpt:dataforseo-scraper:online")) return new Set();
	const result = await db.execute(sql`
  SELECT a.id, a.prompt_id, a.batch_id, a.target_key,
   (t.status = 'submitted' AND t.task_id IS NOT NULL AND (
    (a.status IN ('queued','running') AND a.started_at < now() - interval '20 minutes') OR
    (a.status = 'failed' AND a.completed_at < now() - interval '15 minutes')
   )) AS can_resume
  FROM measurement_attempts a
  JOIN dataforseo_tasks t ON t.key = 'measurement:' || a.id::text
  JOIN brands b ON b.id = a.brand_id AND b.enabled = true
  JOIN prompts p ON p.id = a.prompt_id AND p.enabled = true
  WHERE a.provider = 'dataforseo-scraper' AND a.model = 'chatgpt'
   AND a.target_key = 'chatgpt:dataforseo-scraper:online'
   AND ((b.enabled_targets IS NOT NULL AND a.target_key = ANY(b.enabled_targets)) OR
    (b.enabled_targets IS NULL AND (b.enabled_models IS NULL OR 'chatgpt' = ANY(b.enabled_models))))
   AND t.status IN ('submitted','submitting')
   AND t.created_at > now() - interval '29 days'
   AND (a.status IN ('queued','running') OR
    (a.status = 'failed' AND a.error_code IN ('result_pending_timeout','payment_required','acquisition_failed','submission_unconfirmed')))
 `);
	const pending = new Set<string>();
	for (const row of result.rows as {
		id: string;
		prompt_id: string;
		batch_id: string;
		target_key: string;
		can_resume: boolean;
	}[]) {
		pending.add(row.prompt_id);
		if (!row.can_resume) continue;
		try {
			await enqueue(
				{
					promptId: row.prompt_id,
					singleRun: true,
					measurementBatchId: row.batch_id,
					targetKeys: [row.target_key],
					resumeDataForSeoAttemptId: row.id,
				},
				{
					singletonKey: `dfs-recovery-${row.id}`,
					singletonSeconds: 5 * 60,
					priority: FIRST_RUN_JOB_PRIORITY,
					...PROCESS_PROMPT_JOB_POLICY,
				},
			);
		} catch {
			// Keep this prompt blocked from a second paid cycle even if enqueue failed.
			console.error(`[schedule-maintenance] Could not enqueue DataForSEO recovery ${row.id}`);
		}
	}
	return pending;
}

/** A previously queued recurring job must not buy a new scrape while recovery is pending. */
export async function hasPendingDataForSeoTask(promptId: string, currentBatchId: string): Promise<boolean> {
	const result = await db.execute(sql`
  SELECT true AS pending FROM measurement_attempts a
  JOIN dataforseo_tasks t ON t.key = 'measurement:' || a.id::text
  WHERE a.prompt_id = ${promptId} AND a.batch_id::text <> ${currentBatchId}
   AND a.provider = 'dataforseo-scraper' AND a.target_key = 'chatgpt:dataforseo-scraper:online'
   AND t.status IN ('submitted','submitting') AND t.created_at > now() - interval '29 days'
   AND (a.status IN ('queued','running') OR (a.status = 'failed' AND a.error_code IN
    ('result_pending_timeout','payment_required','acquisition_failed','submission_unconfirmed')))
  LIMIT 1
 `);
	return result.rows.length > 0;
}
