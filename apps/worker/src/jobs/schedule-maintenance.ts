import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { FIRST_RUN_JOB_PRIORITY, getDefaultDelayHours, PROCESS_PROMPT_JOB_POLICY } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { brands, promptRuns, prompts } from "@workspace/lib/db/schema";
import { EXPEDITE_MIN_INTERVAL_MS, shouldExpediteJob } from "@workspace/lib/expedite";
import { measurementTargetKey } from "@workspace/lib/measurement";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import boss from "../boss";
import { recoverDataForSeoTasks } from "./recover-dataforseo";

export interface ScheduleMaintenanceData {
	source?: string; // For logging - "scheduled" or "manual"
}

/**
 * Maintenance job that ensures all enabled prompts have scheduled jobs.
 * This is a self-healing mechanism that catches any prompts that fell through
 * the cracks (e.g., due to worker crashes, failed jobs, etc.).
 *
 * Scheduled in apps/worker/src/index.ts.
 */
export async function scheduleMaintenanceJob(jobs: Job<ScheduleMaintenanceData>[]): Promise<void> {
	for (const job of jobs) {
		const source = job.data?.source || "scheduled";
		console.log(`[schedule-maintenance] Starting maintenance check (source: ${source})`);

		try {
			await runMaintenanceCheck();
		} catch (error) {
			console.error("[schedule-maintenance] Maintenance check failed:", error);
			throw error; // Will trigger retry
		}
	}
}

async function runMaintenanceCheck(): Promise<void> {
	const recoveringPrompts = await recoverDataForSeoTasks(
		(data, options) => boss.send("process-prompt", data, options),
		new Set(parseScrapeTargets(process.env.SCRAPE_TARGETS).map(measurementTargetKey)),
	);
	// Get all enabled brands
	const enabledBrands = await db.query.brands.findMany({
		where: eq(brands.enabled, true),
	});

	if (enabledBrands.length === 0) {
		console.log("[schedule-maintenance] No enabled brands found");
		return;
	}

	const brandIds = enabledBrands.map((b) => b.id);
	const defaultDelayHours = getDefaultDelayHours();
	const brandDelayMap: Record<string, number> = {};
	for (const brand of enabledBrands) {
		brandDelayMap[brand.id] = brand.delayOverrideHours ?? defaultDelayHours;
	}

	// Get all enabled prompts for enabled brands
	const enabledPrompts = await db.query.prompts.findMany({
		where: and(eq(prompts.enabled, true), inArray(prompts.brandId, brandIds)),
	});

	if (enabledPrompts.length === 0) {
		console.log("[schedule-maintenance] No enabled prompts found");
		return;
	}

	console.log(`[schedule-maintenance] Checking ${enabledPrompts.length} enabled prompts`);

	// Bound the last-run scan. prompt_runs only grows and this job runs every five
	// minutes, so aggregating the whole table is a cost that rises forever while the
	// answer only depends on recent rows — anything older than a couple of cadences
	// reads as overdue either way.
	//
	// The floor is what keeps that safe. A prompt with no rows in the window is
	// indistinguishable from one that has never run, and never-run prompts are given
	// first-run priority, so the window has to be wide enough that a merely
	// backlogged prompt still shows up inside it.
	// ponytail: fixed floor; derive it from observed backlog depth if the queue ever
	// runs more than a week behind.
	const maxCadenceHours = Math.max(defaultDelayHours, ...Object.values(brandDelayMap));
	const lastRunWindowMs = Math.max(2 * maxCadenceHours * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);

	// Get last runs per prompt per model (matches dashboard overdue logic)
	const lastRunsQuery = await db
		.select({
			promptId: promptRuns.promptId,
			model: promptRuns.model,
			lastRunAt: sql<Date>`MAX(${promptRuns.createdAt})`.as("last_run_at"),
		})
		.from(promptRuns)
		.where(gte(promptRuns.createdAt, new Date(Date.now() - lastRunWindowMs)))
		.groupBy(promptRuns.promptId, promptRuns.model);

	const lastRunsMap: Record<string, Record<string, Date>> = {};
	for (const run of lastRunsQuery) {
		if (!lastRunsMap[run.promptId]) {
			lastRunsMap[run.promptId] = {};
		}
		lastRunsMap[run.promptId][run.model] = run.lastRunAt;
	}

	// Get all pending jobs with their state info
	const pendingJobMap = await getPendingJobMap();

	const now = Date.now();
	// `neverRun` prompts are tracked separately from merely overdue ones: they are
	// what a new brand's dashboard is waiting on, so they go to the front of the
	// queue rather than behind a backlog that can take most of a day to drain.
	// See FIRST_RUN_JOB_PRIORITY.
	const promptsToSchedule: { promptId: string; cadenceHours: number; neverRun: boolean }[] = [];
	const jobsToExpedite: { jobId: string; neverRun: boolean }[] = [];

	for (const prompt of enabledPrompts) {
		if (recoveringPrompts.has(prompt.id)) continue;
		const pendingJob = pendingJobMap.get(prompt.id);

		// Skip if there's an active or retry job (already being worked on)
		if (pendingJob && (pendingJob.state === "active" || pendingJob.state === "retry")) {
			continue;
		}

		const cadenceHours = brandDelayMap[prompt.brandId] ?? defaultDelayHours;
		const runFrequencyMs = cadenceHours * 60 * 60 * 1000;
		const lastRuns = lastRunsMap[prompt.id] || {};

		// Strict Run Delay Logic:
		// We only care about the most recent time this prompt was run, regardless of which model.
		// If they add a new model to the config, we DO NOT expedite the run. We wait for the strict cadence.
		const allRunTimes = Object.values(lastRuns).map((d) => new Date(d as Date).getTime());
		const neverRun = allRunTimes.length === 0;
		// Most recent run on ANY model, or null if there is none in the window.
		const lastRunAt = neverRun ? null : new Date(Math.max(...allRunTimes));

		// It's only overdue if the MOST RECENT run was longer ago than the cadence.
		const isOverdue = lastRunAt === null || now - lastRunAt.getTime() > runFrequencyMs;

		if (!isOverdue) continue;

		if (pendingJob && pendingJob.state === "created") {
			// There's a future job scheduled - expedite it to run now, unless its
			// delay is a deliberate failure backoff rather than a normal cadence wait.
			const expedite = shouldExpediteJob({
				jobConsecutiveFailures: pendingJob.consecutiveFailures,
				lastRunAt,
				runFrequencyMs,
				now,
				minIntervalMs: EXPEDITE_MIN_INTERVAL_MS,
			});
			if (expedite) jobsToExpedite.push({ jobId: pendingJob.jobId, neverRun });
		} else {
			// No pending job at all - create a new one
			promptsToSchedule.push({ promptId: prompt.id, cadenceHours, neverRun });
		}
	}

	if (promptsToSchedule.length === 0 && jobsToExpedite.length === 0) {
		console.log("[schedule-maintenance] All prompts are on schedule or have pending jobs");
		return;
	}

	console.log(
		`[schedule-maintenance] Found ${promptsToSchedule.length} prompts needing new jobs, ${jobsToExpedite.length} jobs to expedite`,
	);

	// Expedite existing future jobs to run now by updating start_after
	if (jobsToExpedite.length > 0) {
		let expeditedCount = 0;
		for (const { jobId, neverRun } of jobsToExpedite) {
			try {
				await db.execute(sql`
					UPDATE pgboss.job
					SET start_after = now()${neverRun ? sql`, priority = ${FIRST_RUN_JOB_PRIORITY}` : sql``}
					WHERE id = ${jobId}
					  AND state = 'created'
				`);
				expeditedCount++;
			} catch (error) {
				console.error(`[schedule-maintenance] Failed to expedite job ${jobId}:`, error);
			}
		}
		const firstRuns = jobsToExpedite.filter((j) => j.neverRun).length;
		console.log(
			`[schedule-maintenance] Expedited ${expeditedCount} future jobs to run now (${firstRuns} first runs prioritised)`,
		);
	}

	// Schedule new jobs for prompts with no pending job
	if (promptsToSchedule.length > 0) {
		const BATCH_SIZE = 50;
		let successCount = 0;
		let failCount = 0;

		for (let i = 0; i < promptsToSchedule.length; i += BATCH_SIZE) {
			const batch = promptsToSchedule.slice(i, i + BATCH_SIZE);
			const results = await Promise.allSettled(
				batch.map(({ promptId, cadenceHours, neverRun }) =>
					boss.send(
						"process-prompt",
						{ promptId, cadenceHours },
						{
							singletonKey: `prompt-${promptId}`,
							singletonSeconds: 60 * 60, // 1 hour - prevent duplicates
							...(neverRun && { priority: FIRST_RUN_JOB_PRIORITY }),
							...PROCESS_PROMPT_JOB_POLICY,
						},
					),
				),
			);

			for (const result of results) {
				if (result.status === "fulfilled") {
					successCount++;
				} else {
					failCount++;
					console.error("[schedule-maintenance] Failed to schedule job:", result.reason);
				}
			}
		}

		console.log(
			`[schedule-maintenance] Scheduled ${successCount} new jobs${failCount > 0 ? ` (${failCount} failed)` : ""}`,
		);
	}
}

/**
 * Get pending jobs for each prompt, preferring the most active state.
 * Returns at most one job per prompt: active > retry > created.
 */
interface PendingJobInfo {
	jobId: string;
	state: "created" | "active" | "retry";
	/** Failure streak the job carries, written by process-prompt when it reschedules. */
	consecutiveFailures: number;
}

async function getPendingJobMap(): Promise<Map<string, PendingJobInfo>> {
	const result = await db.execute(sql`
		SELECT id, data->>'promptId' as prompt_id, state, data->>'consecutiveFailures' as consecutive_failures
		FROM pgboss.job
		WHERE name = 'process-prompt'
		  AND state IN ('created', 'active', 'retry')
		  AND data->>'promptId' IS NOT NULL
		ORDER BY
			CASE state
				WHEN 'active' THEN 1
				WHEN 'retry' THEN 2
				WHEN 'created' THEN 3
			END
	`);

	const map = new Map<string, PendingJobInfo>();
	for (const row of result.rows as {
		id: string;
		prompt_id: string;
		state: string;
		consecutive_failures: string | null;
	}[]) {
		if (row.prompt_id && !map.has(row.prompt_id)) {
			map.set(row.prompt_id, {
				jobId: row.id,
				state: row.state as "created" | "active" | "retry",
				// Absent on jobs enqueued before this field existed, and on the ones
				// the web app creates.
				consecutiveFailures: Number(row.consecutive_failures) || 0,
			});
		}
	}

	return map;
}
