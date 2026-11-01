import { createServerFn } from "@tanstack/react-start";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { db } from "@workspace/lib/db/db";
import { brands, citations, measurementAttempts, promptRuns, prompts } from "@workspace/lib/db/schema";
import { measurementSurface, measurementTargetKey, measurementTargetLabel } from "@workspace/lib/measurement";
import { selectTargetsForBrand } from "@workspace/lib/providers";
import { extractTextContent } from "@workspace/lib/text-extraction";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { APP_TIMEZONE } from "@/lib/app-locale";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { coerceLookbackPeriod } from "@/lib/chart-utils";
import {
	isComparisonSurface,
	legacyMeasurementTarget,
	measurementEvidenceFallback,
	observedQueries,
	type PromptMeasurementRecord,
	type PromptMeasurementsResponse,
	type PromptMeasurementTarget,
	safeMeasurementCitations,
	safeMeasurementEvidence,
} from "@/lib/prompt-measurements";
import { isPromptRunLanguageFilter, promptRunLanguageCondition } from "@/lib/prompt-run-language";
import { getTimezoneLookbackRange, resolveTimezone } from "@/lib/timezone-utils";

const baseSchema = z.object({
	brandId: z.string().min(1).max(200),
	promptId: z.string().uuid(),
	lookback: z
		.string()
		.max(80)
		.refine((value) => coerceLookbackPeriod(value) === value, "Invalid measurement period")
		.default("1m"),
	language: z.string().refine(isPromptRunLanguageFilter).default("all"),
	timezone: z.string().max(100).default(APP_TIMEZONE),
});

const WEB_PROVIDERS = ["brightdata", "olostep", "cloro", "oxylabs"];
const WEB_MODELS = ["chatgpt", "google-ai-overview"];

async function authorizePrompt(brandId: string, promptId: string) {
	const session = await requireAuthSession();
	await requireOrgAccess(session.user.id, brandId);
	const prompt = await db.query.prompts.findFirst({
		where: and(eq(prompts.brandId, brandId), eq(prompts.id, promptId)),
	});
	if (!prompt) throw new Error("Prompt not found");
}

function periodConditions(data: z.infer<typeof baseSchema>, table: typeof measurementAttempts | typeof promptRuns) {
	const timezone = resolveTimezone(data.timezone);
	const range = getTimezoneLookbackRange(coerceLookbackPeriod(data.lookback), timezone, { allStrategy: "none" });
	return and(
		promptRunLanguageCondition(table.requestContext, data.language),
		range.fromDateStr
			? sql`(${table.createdAt} AT TIME ZONE ${timezone})::date >= ${range.fromDateStr}::date`
			: undefined,
		range.toDateStr ? sql`(${table.createdAt} AT TIME ZONE ${timezone})::date <= ${range.toDateStr}::date` : undefined,
	);
}

type Attempt = typeof measurementAttempts.$inferSelect;
type Run = typeof promptRuns.$inferSelect;
type CitationRow = Pick<typeof citations.$inferSelect, "promptRunId" | "url" | "title">;

function recordFromAttempt(
	attempt: Attempt,
	run: Run | undefined,
	citationRows: CitationRow[],
): PromptMeasurementRecord {
	const queries = observedQueries([
		...(run?.webQueries ?? []),
		...(attempt.evidence?.queryEvidence.map((item) => item.query) ?? []),
	]);
	const text = run ? extractTextContent(run.rawOutput, run.provider ?? run.model) : "";
	return {
		id: attempt.id,
		attemptId: attempt.id,
		runId: attempt.promptRunId,
		targetKey: attempt.targetKey,
		model: attempt.model,
		provider: attempt.provider,
		version: run?.version ?? null,
		status: attempt.status as PromptMeasurementRecord["status"],
		createdAt: attempt.createdAt.toISOString(),
		completedAt: attempt.completedAt?.toISOString() ?? null,
		requestContext: attempt.requestContext ?? run?.requestContext ?? null,
		evidence: safeMeasurementEvidence(
			attempt.evidence ?? measurementEvidenceFallback(text, queries, attempt.webSearchEnabled),
		),
		queries,
		citations: safeMeasurementCitations(citationRows.filter((row) => row.promptRunId === attempt.promptRunId)),
	};
}

function recordFromLegacy(run: Run, citationRows: CitationRow[]): PromptMeasurementRecord {
	const target = legacyMeasurementTarget(run.model, run.provider ?? "", run.version, run.webSearchEnabled);
	const queries = observedQueries(run.webQueries);
	return {
		id: run.id,
		attemptId: null,
		runId: run.id,
		targetKey: target.key,
		model: run.model,
		provider: run.provider ?? "",
		version: run.version,
		status: "succeeded",
		createdAt: run.createdAt.toISOString(),
		completedAt: run.createdAt.toISOString(),
		requestContext: run.requestContext,
		evidence: measurementEvidenceFallback(
			extractTextContent(run.rawOutput, run.provider ?? run.model),
			queries,
			run.webSearchEnabled,
		),
		queries,
		citations: safeMeasurementCitations(citationRows.filter((row) => row.promptRunId === run.id)),
	};
}

async function citationsFor(brandId: string, promptId: string, runIds: string[]) {
	if (!runIds.length) return [];
	return db
		.select({ promptRunId: citations.promptRunId, title: citations.title, url: citations.url })
		.from(citations)
		.where(
			and(eq(citations.brandId, brandId), eq(citations.promptId, promptId), inArray(citations.promptRunId, runIds)),
		);
}

/** Each target has its own limit: one busy engine cannot hide the other. */
export const getPromptMeasurementsFn = createServerFn({ method: "GET" })
	.validator(baseSchema)
	.handler(async ({ data }): Promise<PromptMeasurementsResponse> => {
		await authorizePrompt(data.brandId, data.promptId);
		const brand = await db.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
		if (!brand) throw new Error("Brand not found");
		const targetMap = new Map<string, PromptMeasurementTarget>();
		let configs: ReturnType<typeof parseScrapeTargets> = [];
		try {
			configs = selectTargetsForBrand(
				parseScrapeTargets(process.env.SCRAPE_TARGETS),
				brand.enabledModels,
				brand.enabledTargets,
			);
		} catch {
			/* Invalid deployment configuration is surfaced by startup validation. */
		}
		for (const config of configs.filter((item) => isComparisonSurface(item.model, item.provider))) {
			const key = measurementTargetKey(config);
			targetMap.set(key, {
				key,
				model: config.model,
				provider: config.provider,
				requestedVersion: config.version ?? null,
				webSearch: config.webSearch,
				label: measurementTargetLabel(config.model, config.provider),
				surface: measurementSurface(config.model, config.provider),
				configured: true,
			});
		}
		const attemptsScope = and(
			eq(measurementAttempts.brandId, data.brandId),
			eq(measurementAttempts.promptId, data.promptId),
			inArray(measurementAttempts.model, WEB_MODELS),
			inArray(measurementAttempts.provider, WEB_PROVIDERS),
			periodConditions(data, measurementAttempts),
		);
		const historicalTargets = await db
			.selectDistinct({
				key: measurementAttempts.targetKey,
				model: measurementAttempts.model,
				provider: measurementAttempts.provider,
				requestedVersion: measurementAttempts.requestedVersion,
				webSearch: measurementAttempts.webSearchEnabled,
			})
			.from(measurementAttempts)
			.where(attemptsScope)
			.limit(50);
		for (const item of historicalTargets) {
			if (!isComparisonSurface(item.model, item.provider) || targetMap.has(item.key)) continue;
			targetMap.set(item.key, {
				...item,
				label: measurementTargetLabel(item.model, item.provider),
				surface: measurementSurface(item.model, item.provider),
				configured: false,
			});
		}
		const attemptLists = await Promise.all(
			[...targetMap.values()].map((target) =>
				db.query.measurementAttempts.findMany({
					where: and(attemptsScope, eq(measurementAttempts.targetKey, target.key)),
					orderBy: desc(measurementAttempts.createdAt),
					limit: 20,
				}),
			),
		);
		const attempts = attemptLists.flat();
		const linkedRunIds = attempts.flatMap((item) => (item.promptRunId ? [item.promptRunId] : []));
		const linkedRuns = linkedRunIds.length
			? await db.query.promptRuns.findMany({
					where: and(
						eq(promptRuns.brandId, data.brandId),
						eq(promptRuns.promptId, data.promptId),
						inArray(promptRuns.id, linkedRunIds),
					),
				})
			: [];
		const runMap = new Map(linkedRuns.map((run) => [run.id, run]));
		// Older runs have no attempt or requested target version. Keep a separate legacy identity.
		const legacyRuns = await db.query.promptRuns.findMany({
			where: and(
				eq(promptRuns.brandId, data.brandId),
				eq(promptRuns.promptId, data.promptId),
				inArray(promptRuns.model, WEB_MODELS),
				inArray(promptRuns.provider, WEB_PROVIDERS),
				periodConditions(data, promptRuns),
				sql`NOT EXISTS (SELECT 1 FROM ${measurementAttempts} ma WHERE ma.prompt_run_id = ${promptRuns.id})`,
			),
			orderBy: desc(promptRuns.createdAt),
			limit: 100,
		});
		for (const run of legacyRuns) {
			if (!isComparisonSurface(run.model, run.provider)) continue;
			const target = legacyMeasurementTarget(run.model, run.provider ?? "", run.version, run.webSearchEnabled);
			targetMap.set(target.key, target);
		}
		const citationRows = await citationsFor(data.brandId, data.promptId, [
			...linkedRunIds,
			...legacyRuns.map((run) => run.id),
		]);
		const records = [
			...attempts.map((attempt) =>
				recordFromAttempt(attempt, attempt.promptRunId ? runMap.get(attempt.promptRunId) : undefined, citationRows),
			),
			...legacyRuns
				.filter((run) => isComparisonSurface(run.model, run.provider))
				.map((run) => recordFromLegacy(run, citationRows)),
		];
		return { targets: [...targetMap.values()], records };
	});

export const getPromptMeasurementDetailFn = createServerFn({ method: "GET" })
	.validator(
		baseSchema
			.extend({
				attemptId: z.string().uuid().optional(),
				runId: z.string().uuid().optional(),
				targetKey: z.string().max(500).optional(),
			})
			.refine((data) => Boolean(data.attemptId || data.runId), "An exact measurement is required"),
	)
	.handler(async ({ data }): Promise<PromptMeasurementRecord> => {
		await authorizePrompt(data.brandId, data.promptId);
		const attempt = await db.query.measurementAttempts.findFirst({
			where: and(
				eq(measurementAttempts.brandId, data.brandId),
				eq(measurementAttempts.promptId, data.promptId),
				data.attemptId
					? eq(measurementAttempts.id, data.attemptId)
					: eq(measurementAttempts.promptRunId, data.runId ?? ""),
				data.targetKey && !data.targetKey.startsWith("legacy:")
					? eq(measurementAttempts.targetKey, data.targetKey)
					: undefined,
				periodConditions(data, measurementAttempts),
			),
		});
		if (data.attemptId && !attempt) throw new Error("Measurement not found in this scope");
		const runId = attempt?.promptRunId ?? data.runId;
		const run = runId
			? await db.query.promptRuns.findFirst({
					where: and(
						eq(promptRuns.brandId, data.brandId),
						eq(promptRuns.promptId, data.promptId),
						eq(promptRuns.id, runId),
						periodConditions(data, promptRuns),
					),
				})
			: undefined;
		if (!attempt && !run) throw new Error("Measurement not found in this scope");
		if (!isComparisonSurface(attempt?.model ?? run?.model ?? "", attempt?.provider ?? run?.provider))
			throw new Error("Unsupported measurement surface");
		const citationRows = await citationsFor(data.brandId, data.promptId, run ? [run.id] : []);
		const record = attempt
			? recordFromAttempt(attempt, run, citationRows)
			: run
				? recordFromLegacy(run, citationRows)
				: null;
		if (!record) throw new Error("Measurement not found in this scope");
		if (data.targetKey && data.targetKey !== record.targetKey) throw new Error("Measurement target mismatch");
		if (data.runId && record.runId !== data.runId) throw new Error("Measurement run mismatch");
		const rawOutput = run?.rawOutput ?? attempt?.rawOutput;
		return { ...record, rawOutput: rawOutput != null ? JSON.stringify(rawOutput, null, 2) : undefined };
	});
