import { createServerFn } from "@tanstack/react-start";
import { analyzeBrandMentions, type BrandMentionAnalysis, type MentionCatalog } from "@workspace/lib/brand-mentions";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, measurementAttempts, promptRuns, prompts } from "@workspace/lib/db/schema";
import { measurementTargetLabel } from "@workspace/lib/measurement";
import { extractTextContent } from "@workspace/lib/text-extraction";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { APP_TIMEZONE } from "@/lib/app-locale";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { coerceLookbackPeriod } from "@/lib/chart-utils";
import { measurementRunCondition, visibleMeasurementRunCondition } from "@/lib/measurement-scope";
import { isPromptRunLanguageFilter, promptRunLanguageCondition } from "@/lib/prompt-run-language";
import { getTimezoneLookbackRange } from "@/lib/timezone-utils";

const inputSchema = z.object({
	brandId: z.string().min(1).max(200),
	promptId: z.string().uuid(),
	lookback: z
		.string()
		.max(80)
		.refine((value) => coerceLookbackPeriod(value) === value)
		.default("1m"),
	model: z.string().max(500).optional(),
	targetKey: z.string().max(500).optional(),
	runId: z.string().uuid().optional(),
	attemptId: z.string().uuid().optional(),
	language: z.string().refine(isPromptRunLanguageFilter).default("all"),
});

export interface PromptBrandMentionAnswer {
	runId: string;
	model: string;
	provider: string | null;
	modelLabel: string;
	createdAt: string;
	answerText: string;
	mentionAnalysis: BrandMentionAnalysis;
}

/** Exact historical target links must never select a different provider or version. */
export function mentionTargetCondition(target?: string) {
	if (!target || target === "all") return undefined;
	if (!target.startsWith("legacy:")) return measurementRunCondition(target);
	const [model, provider, version, online] = z
		.tuple([z.string(), z.string(), z.string(), z.boolean()])
		.parse(JSON.parse(target.slice(7)));
	return and(
		eq(promptRuns.model, model),
		eq(promptRuns.provider, provider),
		eq(promptRuns.version, version),
		eq(promptRuns.webSearchEnabled, online),
		sql`NOT EXISTS (SELECT 1 FROM measurement_attempts linked WHERE linked.prompt_run_id = ${promptRuns.id})`,
	);
}

/** A bounded read of stored answers; it never enqueues a new acquisition. */
export const getPromptBrandMentionsFn = createServerFn({ method: "GET" })
	.validator(inputSchema)
	.handler(async ({ data }): Promise<{ answers: PromptBrandMentionAnswer[] }> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const [prompt, brand, competitorRows] = await Promise.all([
			db.query.prompts.findFirst({
				columns: { id: true },
				where: and(eq(prompts.id, data.promptId), eq(prompts.brandId, data.brandId)),
			}),
			db.query.brands.findFirst({
				columns: { id: true, name: true, aliases: true, website: true, additionalDomains: true },
				where: eq(brands.id, data.brandId),
			}),
			db.query.competitors.findMany({ where: eq(competitors.brandId, data.brandId) }),
		]);
		if (!prompt || !brand) throw new Error("Prompt not found");
		const catalog: MentionCatalog = {
			own: {
				id: brand.id,
				name: brand.name,
				aliases: brand.aliases,
				domains: [brand.website, ...brand.additionalDomains],
			},
			competitors: competitorRows,
		};
		const range = getTimezoneLookbackRange(coerceLookbackPeriod(data.lookback), APP_TIMEZONE, { allStrategy: "none" });
		const runs = await db
			.selectDistinctOn([promptRuns.model, promptRuns.provider, promptRuns.version, promptRuns.webSearchEnabled], {
				id: promptRuns.id,
				model: promptRuns.model,
				provider: promptRuns.provider,
				createdAt: promptRuns.createdAt,
				mentionAnalysis: promptRuns.mentionAnalysis,
				evidence: measurementAttempts.evidence,
				rawOutput: sql`CASE WHEN ${measurementAttempts.evidence}->>'answerText' IS NULL THEN ${promptRuns.rawOutput} ELSE NULL END`,
			})
			.from(promptRuns)
			.leftJoin(
				measurementAttempts,
				and(
					eq(measurementAttempts.promptRunId, promptRuns.id),
					eq(measurementAttempts.brandId, data.brandId),
					eq(measurementAttempts.promptId, data.promptId),
					eq(measurementAttempts.model, promptRuns.model),
					eq(measurementAttempts.status, "succeeded"),
				),
			)
			.where(
				and(
					eq(promptRuns.brandId, data.brandId),
					eq(promptRuns.promptId, data.promptId),
					data.runId ? eq(promptRuns.id, data.runId) : data.attemptId ? undefined : visibleMeasurementRunCondition(),
					data.attemptId ? eq(measurementAttempts.id, data.attemptId) : undefined,
					mentionTargetCondition(data.targetKey ?? data.model),
					promptRunLanguageCondition(promptRuns.requestContext, data.language),
					sql`(${measurementAttempts.id} IS NOT NULL OR NOT EXISTS (SELECT 1 FROM measurement_attempts linked WHERE linked.prompt_run_id = ${promptRuns.id}))`,
					range.fromDateStr
						? sql`${promptRuns.createdAt} >= (${range.fromDateStr}::date::timestamp AT TIME ZONE ${APP_TIMEZONE})`
						: undefined,
					range.toDateStr
						? sql`${promptRuns.createdAt} < ((${range.toDateStr}::date + interval '1 day') AT TIME ZONE ${APP_TIMEZONE})`
						: undefined,
				),
			)
			.orderBy(
				promptRuns.model,
				promptRuns.provider,
				promptRuns.version,
				promptRuns.webSearchEnabled,
				desc(promptRuns.createdAt),
				desc(promptRuns.id),
				desc(measurementAttempts.createdAt),
			)
			.limit(20);
		return {
			answers: runs.flatMap((run) => {
				const answerText = run.evidence?.answerText ?? extractTextContent(run.rawOutput, run.provider ?? run.model);
				if (run.evidence && run.evidence.answerStatus !== "shown") return [];
				if (!answerText.trim()) return [];
				return [
					{
						runId: run.id,
						model: run.model,
						provider: run.provider,
						modelLabel: measurementTargetLabel(run.model, run.provider),
						createdAt: run.createdAt.toISOString(),
						answerText,
						mentionAnalysis: run.mentionAnalysis ?? analyzeBrandMentions(answerText, catalog),
					},
				];
			}),
		};
	});
