import type { MeasurementEvidence, QueryEvidence } from "../../measurement";
import { safeEvidenceUrl } from "../../measurement";
import type { Citation } from "../../text-extraction";

type JsonRecord = Record<string, unknown>;

/** Controlled messages, so adapter errors never pass through an SDK response body. */
export class BrightDataEvidenceError extends Error {}

function object(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstText(record: JsonRecord, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = text(record[key]);
		if (value) return value;
	}
}

function source(value: unknown): { url: string; title?: string } | null {
	const record = object(value);
	const url = safeEvidenceUrl(typeof value === "string" ? value : (record?.url ?? record?.link ?? record?.href));
	return url ? { url, ...(text(record?.title) ? { title: text(record?.title) } : {}) } : null;
}

/** Raw protocol JSON is evidence, not answer prose. Never use it as the answer. */
function rawRecord(value: unknown): JsonRecord | undefined {
	if (object(value)) return object(value);
	if (typeof value !== "string") return undefined;
	try {
		return object(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function queryEntries(record: JsonRecord): Array<{ value: unknown; field: string }> {
	const entries: Array<{ value: unknown; field: string }> = [];
	const metadata = object(record.metadata);
	const raw = rawRecord(record.response_raw);
	const containers = [
		{ value: record.web_search_query, field: "web_search_query" },
		{ value: metadata?.search_model_queries, field: "metadata.search_model_queries" },
		{ value: record.search_model_queries, field: "search_model_queries" },
		{ value: object(raw?.metadata)?.search_model_queries, field: "response_raw.metadata.search_model_queries" },
		{ value: raw?.search_model_queries, field: "response_raw.search_model_queries" },
	];
	for (const container of containers) {
		const nested = object(container.value);
		const values = Array.isArray(container.value) ? container.value : nested?.queries;
		if (!Array.isArray(values)) continue;
		const field = nested ? `${container.field}.queries` : container.field;
		for (const value of values) entries.push({ value, field });
	}
	return entries;
}

function reportedQueries(record: JsonRecord): { queries: string[]; evidence: QueryEvidence[] } {
	const queries: string[] = [];
	const seen = new Set<string>();
	const evidence: QueryEvidence[] = [];
	for (const { value, field } of queryEntries(record)) {
		const entry = object(value);
		const query = text(value) ?? firstText(entry ?? {}, ["query", "q", "search_query"]);
		if (!query) continue;
		if (!seen.has(query)) {
			seen.add(query);
			queries.push(query);
		}
		if (!entry) continue;
		// These URLs must be nested under this exact query object. Root-level
		// citations/search_sources do not establish a query→URL relationship.
		for (const [key, role] of [
			["results", "search_result"],
			["citations", "citation"],
			["urls", "unknown"],
		] as const) {
			if (!Array.isArray(entry[key])) continue;
			const urls = (entry[key] as unknown[]).flatMap((item) => {
				const parsed = source(item);
				return parsed ? [{ ...parsed, role }] : [];
			});
			if (urls.length > 0) evidence.push({ query, urls, sourceField: `${field}[].${key}` });
		}
	}
	return { queries, evidence };
}

/** Only answer-level references; organic SERP results are not AIO citations. */
function answerCitations(record: JsonRecord, model: string): Citation[] {
	const output: Citation[] = [];
	const seen = new Set<string>();
	const fields =
		model === "google-ai-overview" ? ["aio_citations"] : ["citations", "links_attached", "sources", "references"];
	for (const field of fields) {
		if (!Array.isArray(record[field])) continue;
		for (const item of record[field] as unknown[]) {
			const parsed = source(item);
			if (!parsed || seen.has(parsed.url)) continue;
			seen.add(parsed.url);
			output.push({
				...parsed,
				domain: new URL(parsed.url).hostname.replace(/^www\./, ""),
				citationIndex: output.length,
			});
		}
	}
	return output;
}

/**
 * Official schemas (2026-11-01):
 * docs.brightdata.com/scrapers/gd_m7aof0k82r803d5bjm.json
 * docs.brightdata.com/scrapers/gd_mfz5x93lmsjjjylob.json
 * AIO exposes aio_text/aio_markdown/aio_citations, not organic query fan-out.
 */
export function normalizeBrightDataEvidence(
	value: unknown,
	model: string,
	webSearch: boolean,
	submittedPrompt?: string,
): { measurement: MeasurementEvidence; queries: string[]; citations: Citation[]; modelVersion?: string } {
	const record = object(value);
	if (!record) throw new BrightDataEvidenceError("BrightData returned an invalid result record");
	if (record.error || record.error_code || record.status === "error" || record.status === "failed") {
		// Upstream error bodies may echo input, account details or credentials.
		throw new BrightDataEvidenceError("BrightData returned a scraper error record");
	}
	const aio = model === "google-ai-overview";
	const answer = firstText(
		record,
		aio
			? ["aio_markdown", "aio_text"]
			: ["answer_text_markdown", "answer_text", "answer", "response", "text", "content"],
	);
	// An explicit AIO field with no content is a valid search without Overview.
	// A different/unknown response shape is not evidence of Overview absence.
	const hasAioField = Object.hasOwn(record, "aio_text") || Object.hasOwn(record, "aio_markdown");
	const hasAioReferences = Array.isArray(record.aio_citations) && record.aio_citations.some((item) => source(item));
	const confirmedNoAio =
		aio &&
		!answer &&
		!hasAioReferences &&
		((hasAioField &&
			[record.aio_text, record.aio_markdown].every(
				(v) => v === null || v === undefined || (typeof v === "string" && !v.trim()),
			)) ||
			record.has_ai_overview === false ||
			(!hasAioField && object(record.general)?.search_engine === "google" && Array.isArray(record.organic)));
	if (!answer && !confirmedNoAio) throw new BrightDataEvidenceError("BrightData answer schema was not recognized");
	const { queries, evidence } = reportedQueries(record);
	const queryStatus = !webSearch
		? "not_used"
		: queries.length > 0
			? "observed"
			: record.web_search_triggered === false
				? "not_used"
				: "not_exposed";
	return {
		measurement: {
			version: 1,
			answerText: answer ?? "",
			answerStatus: confirmedNoAio ? "not_shown" : "shown",
			queryStatus,
			queryEvidence: webSearch ? evidence : [],
			...(submittedPrompt ? { submittedPrompt } : {}),
		},
		queries: webSearch ? queries : [],
		citations: confirmedNoAio ? [] : answerCitations(record, model),
		modelVersion: text(record.model),
	};
}
