import { st } from "@/i18n/visibility-spreadsheet-labels";
import { formatDateTime } from "@/lib/app-locale";
import {
	SPREADSHEET_BATCH_SIZE,
	type SpreadsheetAnswer,
	type VisibilitySpreadsheetResponse,
	type VisibilitySpreadsheetRow,
} from "@/lib/visibility-spreadsheet";

export type EvidenceMode = "domain" | "page";

/** Quote RFC 4180 fields and prevent spreadsheet formula execution, including leading whitespace. */
export function quoteCsv(value: string): string {
	const safe = /^[\t\r\n]|^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function spreadsheetAnswerText(answer: SpreadsheetAnswer | null): string {
	if (!answer) return st("missing");
	if (answer.answerText) return answer.answerText;
	return answer.answerStatus === "not_shown" ? st("notShown") : st("unknown");
}

export function spreadsheetQueries(answer: SpreadsheetAnswer | null): string {
	if (!answer) return st("missing");
	if (answer.webQueries.length) return answer.webQueries.join("\n");
	return answer.queryStatus === "observed"
		? st("noQueries")
		: answer.queryStatus === "not_used"
			? st("searchNotUsed")
			: st("unknown");
}

/** Rank is scoped to one saved answer, never inferred from registration order. */
export function spreadsheetBrands(answer: SpreadsheetAnswer | null): string {
	if (!answer) return st("missing");
	if (!answer.mentionAnalysis) return answer.mentionedBrands.join("\n") || st("noBrands");
	return (
		answer.mentionAnalysis.mentions
			.map((mention) => {
				const rank =
					mention.rank === null
						? st("unknownRank")
						: mention.rankBasis === "explicit"
							? st("explicitRank", { rank: mention.rank })
							: st("appearanceRank", { rank: mention.rank });
				const kind = st(
					mention.kind === "own" ? "ownBrand" : mention.kind === "competitor" ? "competitorBrand" : "unregisteredBrand",
				);
				const basis = st(
					mention.rankBasis === "explicit"
						? "explicitBasis"
						: mention.rankBasis === "appearance"
							? "appearanceBasis"
							: "unknownRank",
				);
				const source = mention.url && /^https?:\/\//i.test(mention.url) ? ` | ${mention.url}` : "";
				return `${rank} | ${mention.name} | ${kind} | ${basis}${source}`;
			})
			.join("\n") || st("noBrands")
	);
}

export function spreadsheetEvidence(answer: SpreadsheetAnswer | null, mode: EvidenceMode): string {
	if (!answer) return st("missing");
	const items =
		mode === "domain"
			? answer.domains.map((item) => ({ ...item, label: item.domain }))
			: answer.pages.map((item) => ({ ...item, label: item.url }));
	if (!items.length)
		return answer.searchResultsStatus === "unknown" || answer.citationsStatus === "unknown"
			? st("unknown")
			: st("noEvidence");
	return items
		.map(
			(item) =>
				`${item.label} | ${st("appearances")}: ${item.appearances ?? st("unknown")} | ${st("citations")}: ${item.citations ?? st("unknown")}`,
		)
		.join("\n");
}

export function spreadsheetCsvHeader(): string {
	return `${[
		"prompt",
		"tags",
		"lastRun",
		"chatgpt",
		"brands",
		"queries",
		"evidence",
		"aiMode",
		"chatgptDate",
		"aiModeDate",
		"aiModeBrands",
	]
		.map((key) => quoteCsv(st(key as Parameters<typeof st>[0])))
		.join(",")}\r\n`;
}

export function spreadsheetCsvRow(row: VisibilitySpreadsheetRow, mode: EvidenceMode): string {
	return `${[
		row.value,
		row.tags.join("\n"),
		row.lastRunAt ? formatDateTime(row.lastRunAt) : st("missing"),
		spreadsheetAnswerText(row.chatgpt),
		spreadsheetBrands(row.chatgpt),
		spreadsheetQueries(row.chatgpt),
		spreadsheetEvidence(row.chatgpt, mode),
		spreadsheetAnswerText(row.aiMode),
		row.chatgpt ? formatDateTime(row.chatgpt.createdAt) : "",
		row.aiMode ? formatDateTime(row.aiMode.createdAt) : "",
		spreadsheetBrands(row.aiMode),
	]
		.map(quoteCsv)
		.join(",")}\r\n`;
}

/** Export independently from the viewport cache: every matching ID, in the table's order. */
export async function collectSpreadsheetCsv({
	promptIds,
	mode,
	fetchBatch,
	onProgress,
	signal,
	asOf: initialAsOf,
	mentionRevision: initialMentionRevision,
}: {
	promptIds: readonly string[];
	mode: EvidenceMode;
	fetchBatch: (ids: string[], asOf?: string) => Promise<VisibilitySpreadsheetResponse>;
	onProgress?: (count: number) => void;
	signal?: AbortSignal;
	asOf?: string;
	mentionRevision?: string;
}): Promise<Blob> {
	const parts = ["\uFEFF", spreadsheetCsvHeader()];
	let asOf = initialAsOf;
	let mentionRevision = initialMentionRevision;
	for (let start = 0; start < promptIds.length; start += SPREADSHEET_BATCH_SIZE) {
		signal?.throwIfAborted();
		const ids = promptIds.slice(start, start + SPREADSHEET_BATCH_SIZE);
		const batch = await fetchBatch(ids, asOf);
		if (mentionRevision !== undefined && batch.mentionRevision !== mentionRevision)
			throw new Error("Mention results changed during export; retry with the updated table");
		mentionRevision ??= batch.mentionRevision;
		signal?.throwIfAborted();
		asOf ??= batch.asOf;
		const rows = new Map(batch.rows.map((row) => [row.id, row]));
		// Deletion/access changes during export must never silently produce a partial CSV.
		if (ids.some((id) => !rows.has(id))) throw new Error("Spreadsheet scope changed during export");
		for (const id of ids) {
			const row = rows.get(id);
			if (!row) throw new Error("Spreadsheet scope changed during export");
			parts.push(spreadsheetCsvRow(row, mode));
		}
		onProgress?.(Math.min(start + ids.length, promptIds.length));
	}
	return new Blob(parts, { type: "text/csv;charset=utf-8" });
}
