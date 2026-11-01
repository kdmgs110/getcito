import { measurementTargetLabel, safeEvidenceUrl, type QueryEvidence } from "@workspace/lib/measurement";
import type { PageEvidence, PageEvidenceAnswer } from "@workspace/lib/page-evidence";
import type { PromptRunRequestContext } from "@workspace/lib/prompt-run-context";

export interface PageEvidenceReadRecord extends Omit<PageEvidenceAnswer, "evidence"> {
	runId: string;
	attemptId: string | null;
	requestContext: PromptRunRequestContext | null;
	queries: string[];
	queryEvidence: QueryEvidence[];
	evidence?: PageEvidence;
}
export interface PageEvidenceScope {
	targetKey?: string;
	model?: string;
	language?: string;
	country?: string;
	scopeKey?: string;
	attemptId?: string;
	runId?: string;
}
const locale = (r: PageEvidenceReadRecord) => ({
	language: r.requestContext?.languageCode ?? (r.requestContext ? "unspecified" : "unrecorded"),
	country: r.requestContext?.countryCode ?? (r.requestContext ? "unspecified" : "unrecorded"),
});
const scopeKey = (r: PageEvidenceReadRecord) => JSON.stringify([locale(r).language, locale(r).country]);

/** One exact target and captured locale; never silently combine provider runs. */
export function buildPageEvidenceResponse(records: PageEvidenceReadRecord[], filters: PageEvidenceScope) {
	const unique = [...new Map(records.map((r) => [r.runId, r])).values()];
	const targets = [
		...new Map(
			unique.map((r) => [
				r.targetKey,
				{ key: r.targetKey, label: measurementTargetLabel(r.model, r.provider), provider: r.provider, model: r.model },
			]),
		).values(),
	];
	const exact = unique.find(
		(r) =>
			(!filters.attemptId || r.attemptId === filters.attemptId) &&
			(!filters.runId || r.runId === filters.runId) &&
			(filters.attemptId || filters.runId),
	);
	const selectedTargetKey = filters.targetKey ?? filters.model ?? exact?.targetKey ?? targets[0]?.key ?? null;
	const byTarget = unique.filter((r) => r.targetKey === selectedTargetKey);
	const scopes = [
		...new Map(
			byTarget.map((r) => {
				const l = locale(r);
				return [scopeKey(r), { key: scopeKey(r), label: `${l.language} / ${l.country}`, ...l }];
			}),
		).values(),
	];
	const preferred = byTarget.find(
		(r) =>
			(!filters.language || filters.language === "all" || locale(r).language === filters.language) &&
			(!filters.country || locale(r).country === filters.country),
	);
	const selectedScopeKey =
		filters.scopeKey ?? (exact ? scopeKey(exact) : preferred ? scopeKey(preferred) : scopes[0]?.key) ?? null;
	const selectedRecords = byTarget.filter(
		(r) =>
			scopeKey(r) === selectedScopeKey &&
			(!filters.language || filters.language === "all" || locale(r).language === filters.language) &&
			(!filters.country || locale(r).country === filters.country) &&
			(!filters.attemptId || r.attemptId === filters.attemptId) &&
			(!filters.runId || r.runId === filters.runId),
	);
	const selectedScope = scopes.find((s) => s.key === selectedScopeKey);
	const queryMap = new Map<
		string,
		{
			query: string;
			answers: Array<{
				id: string;
				attemptId: string | null;
				runId: string;
				targetKey: string;
				createdAt: string;
				provider: string;
			}>;
			relations: Array<QueryEvidence["urls"][number] & { sourceField: string }>;
		}
	>();
	for (const record of selectedRecords)
		for (const query of record.queries) {
			const entry = queryMap.get(query) ?? { query, answers: [], relations: [] };
			entry.answers.push({
				id: record.id,
				attemptId: record.attemptId,
				runId: record.runId,
				targetKey: record.targetKey,
				createdAt: record.createdAt,
				provider: record.provider,
			});
			for (const evidence of record.queryEvidence ?? [])
				if (evidence.query === query)
					for (const url of evidence.urls) {
						const safeUrl = safeEvidenceUrl(url.url);
						if (safeUrl) entry.relations.push({ ...url, url: safeUrl, sourceField: evidence.sourceField });
					}
			queryMap.set(query, entry);
		}
	return {
		targets,
		selectedTargetKey,
		scopes,
		selectedScopeKey,
		selectedLanguage: selectedScope?.language ?? null,
		country: selectedScope?.country ?? null,
		countries: [...new Set(scopes.map((s) => s.country))],
		queries: [...queryMap.values()].sort(
			(a, b) => b.answers.length - a.answers.length || a.query.localeCompare(b.query),
		),
		selectedRecords,
	};
}
