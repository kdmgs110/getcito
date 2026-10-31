import { db } from "@workspace/lib/db/db";
import { prompts, brands } from "@workspace/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { FIRST_RUN_JOB_PRIORITY, getDefaultDelayHours, PROCESS_PROMPT_JOB_POLICY } from "@workspace/lib/constants";
import { getBoss } from "@/lib/boss-client";

/**
 * Convert cadence hours to milliseconds.
 */
export function hoursToMs(hours: number): number {
	return hours * 60 * 60 * 1000;
}

/**
 * Gets the cadence (delay between runs) for a prompt based on its brand's delay override or the default
 */
export async function getPromptCadenceHours(promptId: string): Promise<number> {
	const defaultDelayHours = getDefaultDelayHours();
	try {
		// Get the prompt to find its brand
		const prompt = await db.query.prompts.findFirst({
			where: eq(prompts.id, promptId),
		});

		if (!prompt) {
			console.warn(`Prompt ${promptId} not found, using default cadence`);
			return defaultDelayHours;
		}

		// Get the brand to check for delay override
		const brand = await db.query.brands.findFirst({
			where: eq(brands.id, prompt.brandId),
		});

		if (!brand) {
			console.warn(`Brand ${prompt.brandId} not found, using default cadence`);
			return defaultDelayHours;
		}

		// Use override if set, otherwise use default
		if (brand.delayOverrideHours !== null) {
			console.log(`Using custom cadence for brand ${brand.name}: ${brand.delayOverrideHours}h`);
			return brand.delayOverrideHours;
		}

		return defaultDelayHours;
	} catch (error) {
		console.error(`Error fetching cadence for prompt ${promptId}:`, error);
		return defaultDelayHours;
	}
}

/**
 * Creates a scheduled job for a prompt to run after a delay.
 * Uses interval-based scheduling with startAfter instead of cron patterns.
 * The job will self-reschedule after completion via the worker.
 */
type SchedulerOptions = {
	sendImmediate?: boolean;
};

export async function createPromptJobScheduler(
	promptId: string,
	options: SchedulerOptions = {},
): Promise<boolean> {
	try {
		const boss = await getBoss();
		const cadenceHours = await getPromptCadenceHours(promptId);
		const sendImmediate = options.sendImmediate ?? true;

		// Remove any old cron-based schedule (migration cleanup)
		try {
			await boss.unschedule("process-prompt", promptId);
		} catch {
			// Ignore errors - schedule may not exist
		}

		if (sendImmediate) {
			// Send an immediate job. Every caller of this branch is creating a prompt
			// or re-arming one by hand, so it is a first run — see
			// FIRST_RUN_JOB_PRIORITY for why those skip the backlog.
			await boss.send(
				"process-prompt",
				{ promptId, cadenceHours },
				{
					singletonKey: `prompt-${promptId}`,
					singletonSeconds: 60 * 60, // 1 hour - prevent duplicate jobs
					priority: FIRST_RUN_JOB_PRIORITY,
					...PROCESS_PROMPT_JOB_POLICY,
				},
			);
		} else {
			// Schedule the next run based on cadence
			const startAfterSeconds = cadenceHours * 60 * 60;
			await boss.send(
				"process-prompt",
				{ promptId, cadenceHours },
				{
					singletonKey: `prompt-${promptId}`,
					singletonSeconds: startAfterSeconds, // Prevent duplicates for the cadence period
					startAfter: startAfterSeconds,
					...PROCESS_PROMPT_JOB_POLICY,
				},
			);
		}

		console.log(`Created job for prompt ${promptId} with ${cadenceHours}h cadence`);
		return true;
	} catch (error) {
		console.error(`Failed to create job for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Drops queued `process-prompt` jobs for the given prompts.
 *
 * pg-boss can only delete by job id, and jobs are keyed to a prompt through
 * their payload, so this matches on `data->>'promptId'` directly. Only waiting
 * jobs are removed: an `active` row belongs to a worker that is already mid-run
 * and deleting it would not stop the run.
 *
 * Without this a deleted prompt keeps its queued job, which wakes up, finds no
 * prompt and exits — harmless on its own, but the same job left behind by a
 * *disabled* prompt is what the scheduler reschedules forever.
 */
async function deleteQueuedPromptJobs(promptIds: string[]): Promise<void> {
	if (promptIds.length === 0) return;
	try {
		await db.execute(sql`
			DELETE FROM pgboss.job
			WHERE name = 'process-prompt'
			  AND state IN ('created', 'retry')
			  AND data->>'promptId' IN (${sql.join(
					promptIds.map((id) => sql`${id}`),
					sql`, `,
				)})
		`);
	} catch (error) {
		// pgboss.job is absent until the worker has started once.
		console.error("Failed to delete queued prompt jobs:", error);
	}
}

/**
 * Removes any scheduled jobs for a prompt.
 */
export async function removePromptJobScheduler(promptId: string): Promise<boolean> {
	try {
		const boss = await getBoss();

		// Remove old cron-based schedule if exists
		try {
			await boss.unschedule("process-prompt", promptId);
		} catch {
			// Ignore - may not exist
		}

		await deleteQueuedPromptJobs([promptId]);
		console.log(`Removed schedule for prompt ${promptId}`);
		return true;
	} catch (error) {
		console.error(`Failed to remove job scheduler for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Removes queued work for every prompt of a brand that is being deleted.
 *
 * Both statements cover the whole brand at once rather than looping
 * `removePromptJobScheduler`: this runs inline in the delete request, and
 * `boss.unschedule()` is a single-row DELETE, so a brand with hundreds of
 * prompts would otherwise pay hundreds of round trips against a connection pool
 * far smaller than that.
 */
export async function removeBrandJobSchedulers(promptIds: string[]): Promise<void> {
	if (promptIds.length === 0) return;
	try {
		// Mirrors pg-boss's own `unschedule` statement, which takes one key at a
		// time. Only legacy cron schedules land here — current prompts are driven
		// by self-rescheduling jobs — so this is usually a no-op.
		await db.execute(sql`
			DELETE FROM pgboss.schedule
			WHERE name = 'process-prompt'
			  AND COALESCE(key, '') IN (${sql.join(
					promptIds.map((id) => sql`${id}`),
					sql`, `,
				)})
		`);
	} catch (error) {
		// pgboss.schedule is absent until the worker has started once.
		console.error("Failed to delete prompt schedules:", error);
	}
	await deleteQueuedPromptJobs(promptIds);
	console.log(`Removed queued jobs for ${promptIds.length} prompts`);
}

/**
 * Creates schedules for multiple prompts.
 * Returns an array of results indicating success/failure for each prompt.
 */
export async function createMultiplePromptJobSchedulers(
	promptIds: string[],
	options: SchedulerOptions = {},
): Promise<boolean[]> {
	const results = await Promise.allSettled(
		promptIds.map((promptId) => createPromptJobScheduler(promptId, options)),
	);

	return results.map((result) => (result.status === "fulfilled" ? result.value : false));
}

/**
 * Removes schedules for multiple prompts.
 * Returns an array of results indicating success/failure for each prompt.
 */
export async function removeMultiplePromptJobSchedulers(promptIds: string[]): Promise<boolean[]> {
	const results = await Promise.allSettled(promptIds.map((promptId) => removePromptJobScheduler(promptId)));

	return results.map((result) => (result.status === "fulfilled" ? result.value : false));
}

/**
 * Recreates a schedule for a prompt (removes and creates).
 * Useful when cadence has changed or job needs to be reset.
 */
export async function recreatePromptJobScheduler(
	promptId: string,
	options: SchedulerOptions = {},
): Promise<boolean> {
	try {
		// Remove existing schedule if any (ignore errors if it doesn't exist)
		await removePromptJobScheduler(promptId);
		// Create new schedule
		return await createPromptJobScheduler(promptId, options);
	} catch (error) {
		console.error(`Failed to recreate job scheduler for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Sends an immediate job to process a prompt (outside of the schedule).
 * Useful for manual retries from the admin UI.
 */
export async function sendImmediatePromptJob(promptId: string): Promise<boolean> {
	try {
		const boss = await getBoss();
		const cadenceHours = await getPromptCadenceHours(promptId);

		await boss.send(
			"process-prompt",
			{ promptId, cadenceHours },
			{
				// Someone is watching this one run, so it does not wait behind the
				// scheduled backlog.
				priority: FIRST_RUN_JOB_PRIORITY,
				...PROCESS_PROMPT_JOB_POLICY,
			},
		);

		console.log(`Sent immediate job for prompt ${promptId}`);
		return true;
	} catch (error) {
		console.error(`Failed to send immediate job for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Schedules the next run for a prompt after a delay.
 * Called by the worker after successful job completion.
 */
export async function scheduleNextPromptRun(promptId: string, cadenceHours: number): Promise<boolean> {
	try {
		const boss = await getBoss();
		const startAfterSeconds = cadenceHours * 60 * 60;

		await boss.send(
			"process-prompt",
			{ promptId, cadenceHours },
			{
				singletonKey: `prompt-${promptId}`,
				singletonSeconds: startAfterSeconds, // Prevent duplicates for the cadence period
				startAfter: startAfterSeconds,
				...PROCESS_PROMPT_JOB_POLICY,
			},
		);

		console.log(`Scheduled next run for prompt ${promptId} in ${cadenceHours}h`);
		return true;
	} catch (error) {
		console.error(`Failed to schedule next run for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Sends a report generation job.
 */
export async function sendReportJob(
	reportId: string,
	brandName: string,
	brandWebsite: string,
	manualPrompts?: string[],
	brandId?: string,
	useExistingData?: boolean,
	manualCompetitors?: { name: string; domain: string }[],
	locale: { targetLanguage?: string | null; targetMarket?: string | null } = {},
): Promise<boolean> {
	try {
		const boss = await getBoss();

		await boss.send(
			"generate-report",
			{ reportId, brandName, brandWebsite, manualPrompts, brandId, useExistingData, manualCompetitors, ...locale },
			{
				retryLimit: 3,
				retryDelay: 60,
				retryBackoff: true,
				expireInSeconds: 60 * 60, // 1 hour timeout for reports
			},
		);

		console.log(`Sent report job for report ${reportId}`);
		return true;
	} catch (error) {
		console.error(`Failed to send report job for report ${reportId}:`, error);
		return false;
	}
}
