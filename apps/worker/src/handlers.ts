import * as Sentry from "@sentry/node";
import { positiveIntegerEnv } from "@workspace/config/runtime";
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";
import type { Job, PgBoss } from "pg-boss";
import { type AnalyzeBrandData, analyzeBrandJob } from "./jobs/analyze-brand";
import { type GenerateReportData, generateReportJob } from "./jobs/generate-report";
import { type ProcessPromptData, processPromptJob } from "./jobs/process-prompt";
import { type ScheduleMaintenanceData, scheduleMaintenanceJob } from "./jobs/schedule-maintenance";
import { type SyncAuth0MembershipsData, syncAuth0MembershipsJob } from "./jobs/sync-auth0-memberships";

/**
 * Wraps a pg-boss handler to report errors to Sentry before re-throwing.
 * Preserves the handler's return value (stored by pg-boss as the job output).
 */
function withSentry<T, R>(queueName: string, handler: (jobs: Job<T>[]) => Promise<R>): (jobs: Job<T>[]) => Promise<R> {
	return async (jobs) => {
		try {
			return await handler(jobs);
		} catch (error) {
			Sentry.withScope((scope) => {
				scope.setTag("queue", queueName);
				Sentry.captureException(error);
			});
			throw error;
		}
	};
}

/**
 * Register all job handlers with pg-boss.
 */
export async function registerHandlers(boss: PgBoss): Promise<void> {
	// This is what caps prompts in flight, and it is the queue's real throughput
	// dial: a job spends nearly all of its time waiting on a provider, not on CPU
	// or on the database. The provider gates below it are sized to cover the
	// resulting fan-out (localConcurrency x the Olostep models in SCRAPE_TARGETS),
	// so raising this without raising them just moves the queue from here to there.
	await boss.work<ProcessPromptData>(
		"process-prompt",
		{ localConcurrency: positiveIntegerEnv("WORKER_PROMPT_CONCURRENCY", 10) },
		withSentry("process-prompt", processPromptJob),
	);
	console.log("Registered handler: process-prompt");

	await boss.work<GenerateReportData>(
		"generate-report",
		{ localConcurrency: positiveIntegerEnv("WORKER_REPORT_CONCURRENCY", 2) },
		withSentry("generate-report", generateReportJob),
	);
	console.log("Registered handler: generate-report");

	// batchSize: 1 keeps the returned suggestion mapped 1:1 to a single job's
	// output, which the web app reads back via getJobById.
	await boss.work<AnalyzeBrandData, OnboardingSuggestion>(
		"analyze-brand",
		{ batchSize: 1, localConcurrency: positiveIntegerEnv("WORKER_ANALYSIS_CONCURRENCY", 2) },
		withSentry("analyze-brand", analyzeBrandJob),
	);
	console.log("Registered handler: analyze-brand");

	await boss.work<ScheduleMaintenanceData>(
		"schedule-maintenance",
		{ localConcurrency: 1 },
		withSentry("schedule-maintenance", scheduleMaintenanceJob),
	);
	console.log("Registered handler: schedule-maintenance");

	if (process.env.DEPLOYMENT_MODE === "whitelabel") {
		await boss.work<SyncAuth0MembershipsData>(
			"sync-auth0-memberships",
			{ localConcurrency: 1 },
			withSentry("sync-auth0-memberships", syncAuth0MembershipsJob),
		);
		console.log("Registered handler: sync-auth0-memberships");
	}
}
