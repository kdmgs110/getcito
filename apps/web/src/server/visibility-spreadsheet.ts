import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { brands, citations, measurementAttempts, promptRuns, prompts } from "@workspace/lib/db/schema";
import type { MeasurementEvidence } from "@workspace/lib/measurement";
import { normalizeEvidencePage, normalizePageEvidence } from "@workspace/lib/page-evidence";
import { extractTextContent } from "@workspace/lib/text-extraction";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { APP_TIMEZONE } from "@/lib/app-locale";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { coerceLookbackPeriod } from "@/lib/chart-utils";
import { visibleMeasurementRunCondition } from "@/lib/measurement-scope";
import { measurementEvidenceFallback, observedQueries } from "@/lib/prompt-measurements";
import { getTimezoneLookbackRange } from "@/lib/timezone-utils";
import {
	SPREADSHEET_BATCH_SIZE,
	type SpreadsheetAnswer,
	type SpreadsheetDomain,
	type SpreadsheetPage,
	type VisibilitySpreadsheetResponse,
} from "@/lib/visibility-spreadsheet";

const schema = z.object({
	brandId: z.string().min(1).max(200),
	promptIds: z.array(z.string().uuid()).max(SPREADSHEET_BATCH_SIZE),
	lookback: z
		.string()
		.max(80)
		.refine((value) => coerceLookbackPeriod(value) === value)
		.default("1m"),
	/** Freeze newly arriving results while the user scrolls or exports later batches. */
	asOf: z.string().datetime().optional(),
});

export interface SpreadsheetRun {
	id: string;
	promptId: string;
	model: string;
	provider: string | null;
	createdAt: Date;
	webSearchEnabled: boolean;
	brandMentioned: boolean;
	competitorsMentioned: string[];
	webQueries: string[];
	evidence: MeasurementEvidence | null;
	/** Only selected when historical normalized page evidence is unavailable. */
	rawOutput: unknown;
}

export interface SpreadsheetCitation {
	promptRunId: string;
	url: string;
	title: string | null;
}

/** An evidence count is unknown, rather than zero, when its source is unavailable. */
export function buildSpreadsheetAnswer(
	run: SpreadsheetRun,
	storedCitations: SpreadsheetCitation[],
	brandName: string,
): SpreadsheetAnswer {
	const webQueries = observedQueries([
		...run.webQueries,
		...(run.evidence?.queryEvidence ?? []).map((item) => item.query),
	]);
	const evidence =
		run.evidence ??
		measurementEvidenceFallback(
			extractTextContent(run.rawOutput, run.provider ?? run.model),
			webQueries,
			run.webSearchEnabled,
		);
	if (
		!run.evidence &&
		/^(?:No (?:AI overview content|text content|Google AI mode invoked).*|Error extracting text content\.)$/i.test(
			evidence.answerText.trim(),
		)
	) {
		evidence.answerStatus = "unknown";
	}
	const pageEvidence =
		evidence.pageEvidence ??
		normalizePageEvidence(run.rawOutput, {
			provider: run.provider ?? "",
			model: run.model,
			webSearch: run.webSearchEnabled,
			queryEvidence: evidence.queryEvidence,
		});
	const searchKnown = pageEvidence.search.status === "known";
	// Persisted citations are valid positive evidence for legacy rows, but an
	// empty citations table cannot establish a provider-reported zero.
	const legacyCitations =
		pageEvidence.citations.status === "unknown"
			? storedCitations.flatMap((item) => {
					const page = normalizeEvidencePage(item, "citations");
					return page ? [page] : [];
				})
			: [];
	const citationItems = pageEvidence.citations.status === "known" ? pageEvidence.citations.items : legacyCitations;
	const citationsKnown = pageEvidence.citations.status === "known" || legacyCitations.length > 0;
	const pages = new Map<string, SpreadsheetPage>();
	const getPage = (item: (typeof citationItems)[number]) => {
		let value = pages.get(item.key);
		if (!value) {
			value = {
				url: item.key,
				domain: item.displayDomain,
				title: item.title ?? "",
				appearances: searchKnown ? 0 : null,
				citations: citationsKnown ? 0 : null,
			};
			pages.set(item.key, value);
		}
		if (!value.title && item.title) value.title = item.title;
		return value;
	};
	for (const item of pageEvidence.search.items) {
		const page = getPage(item);
		page.appearances = (page.appearances ?? 0) + 1;
	}
	for (const item of citationItems) {
		const page = getPage(item);
		page.citations = (page.citations ?? 0) + 1;
	}
	const domains = new Map<string, SpreadsheetDomain>();
	for (const page of pages.values()) {
		const domain = domains.get(page.domain) ?? {
			domain: page.domain,
			appearances: searchKnown ? 0 : null,
			citations: citationsKnown ? 0 : null,
		};
		if (page.appearances !== null) domain.appearances = (domain.appearances ?? 0) + page.appearances;
		if (page.citations !== null) domain.citations = (domain.citations ?? 0) + page.citations;
		domains.set(page.domain, domain);
	}
	return {
		runId: run.id,
		createdAt: run.createdAt.toISOString(),
		answerText: evidence.answerStatus === "shown" ? evidence.answerText : "",
		answerStatus: evidence.answerStatus,
		mentionedBrands: [...new Set([...(run.brandMentioned ? [brandName] : []), ...run.competitorsMentioned])],
		webQueries,
		queryStatus: webQueries.length ? "observed" : evidence.queryStatus,
		searchResultsStatus: searchKnown ? "known" : "unknown",
		citationsStatus: citationsKnown ? "known" : "unknown",
		pages: [...pages.values()].sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0) || a.url.localeCompare(b.url)),
		domains: [...domains.values()].sort(
			(a, b) => (b.citations ?? 0) - (a.citations ?? 0) || a.domain.localeCompare(b.domain),
		),
	};
}

/** Small authenticated batches; prompt metadata supplies the stable ordered ID snapshot. */
export const getVisibilitySpreadsheetRowsFn = createServerFn({ method: "GET" })
	.validator(schema)
	.handler(async ({ data }): Promise<VisibilitySpreadsheetResponse> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const asOf = data.asOf ?? new Date().toISOString();
		const promptIds = [...new Set(data.promptIds)];
		if (!promptIds.length) return { rows: [], asOf };
		const [promptRows, brand] = await Promise.all([
			db
				.select({ id: prompts.id, value: prompts.value, tags: prompts.tags })
				.from(prompts)
				.where(and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true), inArray(prompts.id, promptIds))),
			db.query.brands.findFirst({ columns: { name: true }, where: eq(brands.id, data.brandId) }),
		]);
		const scopedIds = promptRows.map((item) => item.id);
		if (!scopedIds.length) return { rows: [], asOf };
		const { fromDateStr, toDateStr } = getTimezoneLookbackRange(coerceLookbackPeriod(data.lookback), APP_TIMEZONE, {
			now: new Date(asOf),
		});
		// DISTINCT ON bounds large answer payloads to at most two runs per prompt.
		// raw_output is deliberately omitted for modern normalized measurements.
		const runs: SpreadsheetRun[] = await db
			.selectDistinctOn([promptRuns.promptId, promptRuns.model], {
				id: promptRuns.id,
				promptId: promptRuns.promptId,
				model: promptRuns.model,
				provider: promptRuns.provider,
				createdAt: promptRuns.createdAt,
				webSearchEnabled: promptRuns.webSearchEnabled,
				brandMentioned: promptRuns.brandMentioned,
				competitorsMentioned: promptRuns.competitorsMentioned,
				webQueries: promptRuns.webQueries,
				evidence: measurementAttempts.evidence,
				rawOutput: sql`CASE WHEN ${measurementAttempts.evidence}->'pageEvidence' IS NULL THEN ${promptRuns.rawOutput} ELSE NULL END`,
			})
			.from(promptRuns)
			.leftJoin(
				measurementAttempts,
				and(
					eq(measurementAttempts.promptRunId, promptRuns.id),
					eq(measurementAttempts.brandId, data.brandId),
					eq(measurementAttempts.promptId, promptRuns.promptId),
					eq(measurementAttempts.model, promptRuns.model),
					eq(measurementAttempts.status, "succeeded"),
				),
			)
			.where(
				and(
					eq(promptRuns.brandId, data.brandId),
					inArray(promptRuns.promptId, scopedIds),
					visibleMeasurementRunCondition(),
					// Linked failed/pending acquisitions cannot masquerade as successful
					// answers; old runs without any receipt remain readable.
					sql`(${measurementAttempts.id} IS NOT NULL OR NOT EXISTS (
						SELECT 1 FROM measurement_attempts linked WHERE linked.prompt_run_id = ${promptRuns.id}
					))`,
					or(
						and(
							eq(promptRuns.model, "chatgpt"),
							eq(promptRuns.provider, "dataforseo-scraper"),
							eq(promptRuns.webSearchEnabled, true),
						),
						eq(promptRuns.model, "google-ai-mode"),
					),
					lte(promptRuns.createdAt, new Date(asOf)),
					fromDateStr
						? sql`${promptRuns.createdAt} >= (${fromDateStr}::date::timestamp AT TIME ZONE ${APP_TIMEZONE})`
						: undefined,
					toDateStr
						? sql`${promptRuns.createdAt} < ((${toDateStr}::date + interval '1 day') AT TIME ZONE ${APP_TIMEZONE})`
						: undefined,
				),
			)
			.orderBy(
				promptRuns.promptId,
				promptRuns.model,
				desc(promptRuns.createdAt),
				desc(promptRuns.id),
				desc(measurementAttempts.createdAt),
			);
		const runIds = runs.map((run) => run.id);
		const citationRows = runIds.length
			? await db
					.select({
						promptRunId: citations.promptRunId,
						url: citations.url,
						title: citations.title,
					})
					.from(citations)
					.where(and(eq(citations.brandId, data.brandId), inArray(citations.promptRunId, runIds)))
			: [];
		const answers = new Map(
			runs.map((run) => [
				`${run.promptId}:${run.model}`,
				buildSpreadsheetAnswer(
					run,
					citationRows.filter((item) => item.promptRunId === run.id),
					brand?.name ?? "",
				),
			]),
		);
		const promptMap = new Map(promptRows.map((item) => [item.id, item]));
		return {
			asOf,
			rows: promptIds.flatMap((id) => {
				const prompt = promptMap.get(id);
				if (!prompt) return [];
				const chatgpt = answers.get(`${id}:chatgpt`) ?? null;
				const aiMode = answers.get(`${id}:google-ai-mode`) ?? null;
				const dates = [chatgpt?.createdAt, aiMode?.createdAt].filter((value): value is string => !!value).sort();
				return [{ ...prompt, lastRunAt: dates.at(-1) ?? null, chatgpt, aiMode }];
			}),
		};
	});
