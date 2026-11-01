import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { measurementAttempts, promptRuns, prompts } from "@workspace/lib/db/schema";
import { aggregatePageEvidence, normalizePageEvidence } from "@workspace/lib/page-evidence";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { APP_TIMEZONE } from "@/lib/app-locale";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { coerceLookbackPeriod } from "@/lib/chart-utils";
import { isComparisonSurface, legacyMeasurementTarget, observedQueries } from "@/lib/prompt-measurements";
import { isPromptRunLanguageFilter, promptRunLanguageCondition } from "@/lib/prompt-run-language";
import { getTimezoneLookbackRange, resolveTimezone } from "@/lib/timezone-utils";
import { buildPageEvidenceResponse, type PageEvidenceReadRecord } from "@/lib/page-evidence-response";

export const pageEvidenceSchema = z.object({
	brandId: z.string().min(1).max(200),
	promptId: z.string().uuid(),
	lookback: z
		.string()
		.max(80)
		.refine((v) => coerceLookbackPeriod(v) === v)
		.default("1m"),
	language: z.string().refine(isPromptRunLanguageFilter).default("all"),
	timezone: z.string().max(100).default(APP_TIMEZONE),
	targetKey: z.string().max(500).optional(),
	model: z.string().max(500).optional(),
	scopeKey: z.string().max(200).optional(),
	country: z.string().max(80).optional(),
	attemptId: z.string().uuid().optional(),
	runId: z.string().uuid().optional(),
});

/** Select only evidence fields, never response prose or full raw payloads. */
function rawProjection(raw: ReturnType<typeof sql>) {
	return sql`jsonb_build_object('status_code',${raw}->'status_code','tasks', jsonb_build_array(jsonb_build_object('status_code',${raw}->'tasks'->0->'status_code','result',jsonb_build_array(jsonb_build_object('markdown',CASE WHEN length(${raw}->'tasks'->0->'result'->0->>'markdown')>0 THEN '[stored answer]' ELSE NULL END,'web_search_triggered',${raw}->'tasks'->0->'result'->0->'web_search_triggered','search_results',${raw}->'tasks'->0->'result'->0->'search_results','sources',${raw}->'tasks'->0->'result'->0->'sources','web_search',${raw}->'tasks'->0->'result'->0->'web_search')))), 'citations',${raw}->'citations','links_attached',${raw}->'links_attached','sources',${raw}->'sources','references',${raw}->'references','search_results',${raw}->'search_results','aio_citations',${raw}->'aio_citations','web_search_triggered',${raw}->'web_search_triggered')`;
}

export const getPromptPageEvidenceFn = createServerFn({ method: "GET" })
	.validator(pageEvidenceSchema)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const prompt = await db.query.prompts.findFirst({
			columns: { id: true },
			where: and(eq(prompts.id, data.promptId), eq(prompts.brandId, data.brandId)),
		});
		if (!prompt) throw new Error("Prompt not found");
		const timezone = resolveTimezone(data.timezone);
		const range = getTimezoneLookbackRange(coerceLookbackPeriod(data.lookback), timezone, { allStrategy: "none" });
		const period = (table: typeof promptRuns | typeof measurementAttempts) =>
			and(
				promptRunLanguageCondition(table.requestContext, data.language),
				range.fromDateStr
					? sql`(${table.createdAt} AT TIME ZONE ${timezone})::date >= ${range.fromDateStr}::date`
					: undefined,
				range.toDateStr
					? sql`(${table.createdAt} AT TIME ZONE ${timezone})::date <= ${range.toDateStr}::date`
					: undefined,
			);
		const scope = and(
			eq(promptRuns.brandId, data.brandId),
			eq(promptRuns.promptId, data.promptId),
			period(promptRuns),
			inArray(promptRuns.model, ["chatgpt", "google-ai-overview"]),
			inArray(promptRuns.provider, ["brightdata", "dataforseo-scraper", "olostep", "cloro", "oxylabs"]),
		);
		const rows = await db
			.select({
				id: promptRuns.id,
				model: promptRuns.model,
				provider: promptRuns.provider,
				version: promptRuns.version,
				webSearch: promptRuns.webSearchEnabled,
				createdAt: promptRuns.createdAt,
				requestContext: promptRuns.requestContext,
				queries: promptRuns.webQueries,
				attemptId: measurementAttempts.id,
				targetKey: measurementAttempts.targetKey,
				queryEvidence: sql`COALESCE(${measurementAttempts.evidence}->'queryEvidence','[]'::jsonb)`,
			})
			.from(promptRuns)
			.leftJoin(
				measurementAttempts,
				and(eq(measurementAttempts.promptRunId, promptRuns.id), eq(measurementAttempts.status, "succeeded")),
			)
			.where(scope)
			.orderBy(desc(promptRuns.createdAt));
		const records: PageEvidenceReadRecord[] = rows
			.filter((r) => isComparisonSurface(r.model, r.provider))
			.map((r) => ({
				id: r.id,
				runId: r.id,
				attemptId: r.attemptId,
				targetKey: r.targetKey ?? legacyMeasurementTarget(r.model, r.provider ?? "", r.version, r.webSearch).key,
				provider: r.provider ?? "",
				model: r.model,
				createdAt: r.createdAt.toISOString(),
				requestContext: r.requestContext,
				queries: observedQueries(r.queries),
				queryEvidence: r.queryEvidence as PageEvidenceReadRecord["queryEvidence"],
			}));
		const initial = buildPageEvidenceResponse(records, data);
		const selected = initial.selectedRecords;
		if (selected.length) {
			const evidenceRows = await db
				.select({
					id: promptRuns.id,
					evidence: sql`COALESCE(${measurementAttempts.evidence}->'pageEvidence',NULL)`,
					raw: rawProjection(sql`${promptRuns.rawOutput}::jsonb`),
				})
				.from(promptRuns)
				.leftJoin(
					measurementAttempts,
					and(eq(measurementAttempts.promptRunId, promptRuns.id), eq(measurementAttempts.status, "succeeded")),
				)
				.where(
					and(
						scope,
						inArray(
							promptRuns.id,
							selected.map((r) => r.runId),
						),
					),
				);
			const byId = new Map(evidenceRows.map((r) => [r.id, r]));
			for (const record of selected) {
				const row = byId.get(record.runId);
				record.evidence = (row?.evidence ??
					normalizePageEvidence(row?.raw, { provider: record.provider, model: record.model })) as NonNullable<
					PageEvidenceReadRecord["evidence"]
				>;
			}
		}
		const { selectedRecords, ...response } = initial;
		const answers = selectedRecords.map((r) => ({
			...r,
			evidence: r.evidence ?? normalizePageEvidence(null, { provider: r.provider, model: r.model }),
		}));
		return {
			...response,
			pages: aggregatePageEvidence(answers, { groupBy: "page" }),
			domains: aggregatePageEvidence(answers, { groupBy: "domain" }),
		};
	});
