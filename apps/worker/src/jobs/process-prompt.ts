import { randomUUID } from "node:crypto";
import { getDefaultDelayHours, PROCESS_PROMPT_JOB_POLICY, RUNS_PER_PROMPT } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import {
	type Brand,
	brands,
	type Competitor,
	citations,
	competitors,
	measurementAttempts,
	promptRuns,
	prompts,
} from "@workspace/lib/db/schema";
import { type MeasurementEvidence, measurementTargetKey } from "@workspace/lib/measurement";
import { buildPromptRunRequestContext } from "@workspace/lib/prompt-run-context";
import {
	getProvider,
	type ModelConfig,
	type Provider,
	parseScrapeTargets,
	selectTargetsForBrand,
	withProviderCallTracking,
} from "@workspace/lib/providers";
import { failureBackoffHours } from "@workspace/lib/run-backoff";
import { and, eq, lt, or } from "drizzle-orm";
import type { Job } from "pg-boss";
import boss from "../boss";
import { trackWorkerEvent } from "../telemetry";

export interface ProcessPromptData {
	promptId: string;
	/** Operator-requested, bounded remeasurement; never changes recurring scheduling. */
	singleRun?: boolean;
	allowDisabledPrompt?: boolean;
	targetKeys?: string[];
	measurementBatchId?: string;
	cadenceHours?: number; // Hours until next run (for self-rescheduling)
	/** Cycles in a row where every run failed, carried forward to size the backoff. */
	consecutiveFailures?: number;
}

interface PromptContext {
	prompt: typeof prompts.$inferSelect;
	brand: Brand;
	competitors: Competitor[];
}

/**
 * Schedule the next run for a prompt.
 *
 * Normally that's one cadence away; after a cycle where every run failed it's
 * the shorter backoff from failureBackoffHours, and `consecutiveFailures` rides
 * along on the job so the next failure can lengthen it again.
 */
async function scheduleNextRun(promptId: string, cadenceHours: number, consecutiveFailures: number): Promise<void> {
	const delayHours = failureBackoffHours(consecutiveFailures, cadenceHours);
	const startAfterSeconds = Math.round(delayHours * 60 * 60);

	try {
		await boss.send(
			"process-prompt",
			{ promptId, cadenceHours, consecutiveFailures },
			{
				singletonKey: `prompt-${promptId}`,
				singletonSeconds: startAfterSeconds, // Prevent duplicates until the next attempt is due
				startAfter: startAfterSeconds,
				...PROCESS_PROMPT_JOB_POLICY,
			},
		);
		const reason = consecutiveFailures > 0 ? ` (backing off after ${consecutiveFailures} failed cycle(s))` : "";
		console.log(`Scheduled next run for prompt ${promptId} in ${delayHours}h${reason}`);
	} catch (error) {
		console.error(`Failed to schedule next run for prompt ${promptId}:`, error);
		// Don't throw - we don't want to fail the job just because rescheduling failed
	}
}

async function getPromptContext(promptId: string): Promise<PromptContext | null> {
	const prompt = await db.query.prompts.findFirst({
		where: eq(prompts.id, promptId),
	});

	if (!prompt) {
		console.error(`Prompt not found: ${promptId}`);
		return null;
	}

	const brand = await db.query.brands.findFirst({
		where: eq(brands.id, prompt.brandId),
	});

	if (!brand) {
		console.error(`Brand not found: ${prompt.brandId}`);
		return null;
	}

	const brandCompetitors = await db.query.competitors.findMany({
		where: eq(competitors.brandId, prompt.brandId),
	});

	return {
		prompt,
		brand,
		competitors: brandCompetitors,
	};
}

function extractDomainFromUrl(urlOrDomain: string): string {
	try {
		const url = new URL(urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`);
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return urlOrDomain.replace(/^www\./, "").toLowerCase();
	}
}

function analyzeMentions(
	content: string,
	brand: Brand,
	competitorsList: Competitor[],
): {
	brandMentioned: boolean;
	competitorsMentioned: string[];
} {
	const contentLower = content.toLowerCase();

	const brandNames = [brand.name, ...(brand.aliases || [])].map((n) => n.toLowerCase());
	const brandDomains = [
		extractDomainFromUrl(brand.website),
		...(brand.additionalDomains || []).map(extractDomainFromUrl),
	];
	const brandMentioned =
		brandNames.some((n) => contentLower.includes(n)) || brandDomains.some((d) => contentLower.includes(d));

	const competitorsMentioned = competitorsList
		.filter((competitor) => {
			const names = [competitor.name, ...(competitor.aliases || [])].map((n) => n.toLowerCase());
			const nameMatch = names.some((n) => contentLower.includes(n));
			const domainMatch = (competitor.domains || []).some((d) => contentLower.includes(extractDomainFromUrl(d)));
			return nameMatch || domainMatch;
		})
		.map((competitor) => competitor.name);

	return { brandMentioned, competitorsMentioned };
}

async function runModelIteration({
	promptId,
	promptValue,
	brand,
	competitorsList,
	config,
	providerImpl,
	runIndex,
	batchId,
}: {
	promptId: string;
	promptValue: string;
	brand: Brand;
	competitorsList: Competitor[];
	config: ModelConfig;
	providerImpl: Provider;
	runIndex: number;
	batchId: string;
}): Promise<void> {
	const logPrefix = `[${config.model}_${runIndex}]`;
	const requestContext = buildPromptRunRequestContext(promptValue, brand);
	const targetKey = measurementTargetKey(config);
	// The unique batch/target/iteration key prevents a retry of a partially
	// successful pair from submitting the successful target for a second time.
	const [attempt] = await db
		.insert(measurementAttempts)
		.values({
			batchId,
			brandId: brand.id,
			promptId,
			targetKey,
			model: config.model,
			provider: config.provider,
			requestedVersion: config.version ?? null,
			webSearchEnabled: config.webSearch,
			iteration: runIndex,
			status: "running",
			requestContext,
		})
		.onConflictDoUpdate({
			target: [
				measurementAttempts.batchId,
				measurementAttempts.promptId,
				measurementAttempts.targetKey,
				measurementAttempts.iteration,
			],
			set: { status: "running", startedAt: new Date(), completedAt: null, errorCode: null },
			setWhere: or(
				eq(measurementAttempts.status, "failed"),
				and(
					eq(measurementAttempts.status, "running"),
					lt(measurementAttempts.startedAt, new Date(Date.now() - 20 * 60_000)),
				),
			),
		})
		.returning({ id: measurementAttempts.id });
	if (!attempt) {
		console.log(`${logPrefix} Target already completed or running in this measurement batch; skipped`);
		return;
	}
	try {
		// Locale and web search silently degrade rather than fail: a provider with no
		// targetMarket geolocates from its own IP, and webSearch=false (no `:online`
		// in SCRAPE_TARGETS) means the model answers from training data with no
		// citations. Log what was actually sent so those two look different in the log.
		console.log(
			`${logPrefix} market=${brand.targetMarket ?? "none"} language=${brand.targetLanguage ?? "none"} webSearch=${config.webSearch}`,
		);

		const result = await withProviderCallTracking(
			{ provider: providerImpl.id, model: config.model, kind: "run", brandId: brand.id, promptId },
			() =>
				providerImpl.run(config.model, requestContext.prompt, {
					webSearch: config.webSearch,
					version: config.version,
					targetMarket: requestContext.targetMarket ?? undefined,
					targetLanguage: requestContext.targetLanguage ?? undefined,
				}),
		);

		// `webQueries` is stored exactly as the provider reported it — engines do
		// sometimes genuinely search the prompt verbatim, and that's real data. The
		// fan-out page excludes verbatim repeats at read time as a display rule;
		// providers whose query field is fabricated (DataForSEO) write the
		// `unavailable` sentinel in their own extractor instead.
		const { rawOutput, textContent, webQueries, citations: extractedCitations, modelVersion } = result;
		console.log(`${logPrefix} AI call completed, textContent length: ${textContent?.length ?? "null"}`);

		const safeTextContent = typeof textContent === "string" ? textContent : "";

		const { brandMentioned, competitorsMentioned } = analyzeMentions(safeTextContent, brand, competitorsList);

		const recordedVersion = modelVersion ?? config.version ?? config.provider;

		const evidence: MeasurementEvidence = result.measurement ?? {
			version: 1,
			answerText: safeTextContent,
			answerStatus: safeTextContent.trim() ? "shown" : "unknown",
			queryStatus: !config.webSearch
				? "not_used"
				: webQueries.some((query) => query !== "unavailable")
					? "observed"
					: "not_exposed",
			queryEvidence: [],
			submittedPrompt: requestContext.prompt,
		};
		if (evidence.answerStatus === "unknown") throw new Error("MEASUREMENT_RESPONSE_UNRECOGNIZED");
		await db.transaction(async (tx) => {
			let promptRunId: string | null = null;
			// A search with no Overview is a valid observation, not an answer. Keep
			// it out of the pre-existing answer and mention-rate denominators.
			if (evidence.answerStatus === "shown") {
				const [run] = await tx
					.insert(promptRuns)
					.values({
						promptId,
						brandId: brand.id,
						model: config.model,
						provider: config.provider,
						version: recordedVersion,
						webSearchEnabled: config.webSearch,
						rawOutput,
						webQueries,
						brandMentioned,
						competitorsMentioned,
						requestContext,
					})
					.returning({ id: promptRuns.id, createdAt: promptRuns.createdAt });
				promptRunId = run.id;
				if (extractedCitations.length)
					await tx.insert(citations).values(
						extractedCitations.map((citation) => ({
							promptRunId: run.id,
							promptId,
							brandId: brand.id,
							model: config.model,
							url: citation.url,
							domain: citation.domain,
							title: citation.title ?? null,
							citationIndex: citation.citationIndex,
							createdAt: run.createdAt,
						})),
					);
			}
			await tx
				.update(measurementAttempts)
				.set({
					status: "succeeded",
					evidence,
					rawOutput: promptRunId ? null : rawOutput,
					promptRunId,
					completedAt: new Date(),
					errorCode: null,
				})
				.where(eq(measurementAttempts.id, attempt.id));
		});
		console.log(`${logPrefix} Saved measurement ${attempt.id} (${evidence.answerStatus})`);
	} catch (error) {
		await db
			.update(measurementAttempts)
			.set({ status: "failed", errorCode: "acquisition_failed", completedAt: new Date() })
			.where(eq(measurementAttempts.id, attempt.id));
		throw error;
	}
}

/**
 * Process a prompt - runs AI models and saves results.
 * This is a pg-boss job handler, called when a scheduled job fires.
 * After successful completion, schedules the next run.
 */
export async function processPromptJob(jobs: Job<ProcessPromptData>[]): Promise<void> {
	const scrapeConfigs = parseScrapeTargets(process.env.SCRAPE_TARGETS);

	// pg-boss v12 passes an array of jobs - process each one
	for (const job of jobs) {
		const { promptId } = job.data;
		const singleRun = job.data.singleRun === true;
		const batchId = job.data.measurementBatchId ?? job.id ?? randomUUID();
		const consecutiveFailures = job.data.consecutiveFailures ?? 0;
		console.log(`Processing prompt ${promptId}`);

		// Get prompt context
		const context = await getPromptContext(promptId);
		if (!context) {
			console.log(`Prompt ${promptId} not found, skipping (no reschedule)`);
			continue; // Job completes successfully - prompt was deleted, don't reschedule
		}

		const { prompt, brand, competitors: competitorsList } = context;

		// Read the cadence from the brand rather than from `job.data.cadenceHours`.
		// A job re-embeds its own cadence when it schedules the next run, so the
		// payload value is whatever was current when the *first* job in the chain
		// was created and it propagates forever - changing the delay override in the
		// admin panel would move the dashboard's idea of "overdue" while the actual
		// runs carried on at the old interval. The payload field is still written so
		// the value a run used stays visible in the job log; it is no longer read.
		const cadenceHours = brand.delayOverrideHours ?? getDefaultDelayHours();

		// Check if prompt and brand are enabled
		if ((!prompt.enabled && !(singleRun && job.data.allowDisabledPrompt)) || !brand.enabled) {
			console.log(`Prompt ${promptId} or brand ${brand.id} is disabled, skipping but rescheduling`);
			// Still reschedule - the prompt might be enabled later
			if (!singleRun) await scheduleNextRun(promptId, cadenceHours, 0);
			continue;
		}

		let selectedConfigs = selectTargetsForBrand(scrapeConfigs, brand.enabledModels, brand.enabledTargets);
		if (singleRun && job.data.targetKeys) {
			const available = new Set(scrapeConfigs.map(measurementTargetKey));
			if (job.data.targetKeys.some((key) => !available.has(key))) throw new Error("UNKNOWN_MEASUREMENT_TARGET");
			selectedConfigs = scrapeConfigs.filter((config) => job.data.targetKeys?.includes(measurementTargetKey(config)));
		}
		if (selectedConfigs.length === 0) {
			console.log(`Prompt ${promptId} for brand ${brand.id} has no targets (brand.enabledModels=[])`);
		}

		console.log(`Processing prompt "${prompt.value}" for brand "${brand.name}"`);

		// Run all model iterations in parallel
		const runPromises: Promise<void>[] = [];
		// Same order as runPromises, so a rejection can name the model that failed
		// instead of an index into the (shorter) failures array.
		const runLabels: string[] = [];

		for (const config of selectedConfigs) {
			const providerImpl = getProvider(config.provider);
			for (let i = 0; i < RUNS_PER_PROMPT; i++) {
				runLabels.push(`${config.model}_${i + 1}`);
				runPromises.push(
					runModelIteration({
						promptId,
						promptValue: prompt.value,
						brand,
						competitorsList,
						config,
						providerImpl,
						runIndex: i + 1,
						batchId,
					}),
				);
			}
		}

		const results = await Promise.allSettled(runPromises);
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

		if (failures.length > 0) {
			const errorMessages = results
				.map((result, i) =>
					result.status === "rejected"
						? `[${runLabels[i]}] ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
						: null,
				)
				.filter(Boolean)
				.join("; ");

			console.error(`Prompt ${promptId} had ${failures.length}/${runPromises.length} failed runs: ${errorMessages}`);
		}

		const successCount = runPromises.length - failures.length;
		console.log(`Completed prompt ${promptId}: ${successCount}/${runPromises.length} successful runs`);

		trackWorkerEvent("prompt_processed", {
			brand_id: brand.id,
			models: [...new Set(selectedConfigs.map((c) => c.model))],
			providers: [...new Set(selectedConfigs.map((c) => c.provider))],
			total_runs: runPromises.length,
			successful_runs: successCount,
			failed_runs: failures.length,
		});

		// A cycle where nothing came back means the targets themselves are failing,
		// so the next attempt backs off instead of running on cadence. Anything
		// that produced a run clears the streak. The backoff is capped at the
		// cadence, so a prompt that stays broken costs what a healthy one costs
		// rather than more.
		const failedCycles = runPromises.length > 0 && successCount === 0 ? consecutiveFailures + 1 : 0;
		if (!singleRun) await scheduleNextRun(promptId, cadenceHours, failedCycles);
		else if (failures.length > 0) throw new Error("MEASUREMENT_BATCH_PARTIALLY_FAILED");
	}
}
