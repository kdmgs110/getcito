import { type GscRow, getAiQuestionSignals, type SearchConsoleFilters } from "@workspace/lib/search-console";

export type KeywordSort = "query" | "impressions" | "clicks" | "ctr" | "position" | "aiLikelihood";
export interface KeywordSearch {
	startDate?: string;
	endDate?: string;
	keyword?: string;
	aiQuestionsOnly?: boolean;
	urlConditions?: string;
	page?: number;
	sort?: KeywordSort;
	direction?: "asc" | "desc";
	gsc?: "connected" | "error";
	invalidFilters?: boolean;
}
export function parseUrlConditions(value: unknown): SearchConsoleFilters["urlConditions"] | null {
	if (typeof value !== "string" || value.length > 25000) return null;
	try {
		const rows: unknown = JSON.parse(value);
		if (!Array.isArray(rows) || rows.length > 10) return null;
		if (
			!rows.every(
				(row) =>
					row &&
					typeof row === "object" &&
					["contains", "notContains", "equals", "subtree"].includes(row.operator) &&
					typeof row.value === "string" &&
					row.value.trim().length > 0 &&
					row.value.length <= 2048,
			)
		)
			return null;
		return rows.map(({ operator, value }) => ({ operator, value }));
	} catch {
		return null;
	}
}
export function validateKeywordSearch(search: Record<string, unknown>): KeywordSearch {
	const output: KeywordSearch = {};
	for (const key of ["startDate", "endDate", "keyword"] as const) {
		if (typeof search[key] === "string" && search[key].length <= 2048) output[key] = search[key];
		else if (search[key] !== undefined) output.invalidFilters = true;
	}
	if (search.aiQuestionsOnly === true || search.aiQuestionsOnly === "true") output.aiQuestionsOnly = true;
	else if (
		search.aiQuestionsOnly !== undefined &&
		search.aiQuestionsOnly !== false &&
		search.aiQuestionsOnly !== "false"
	)
		output.invalidFilters = true;
	if (search.urlConditions !== undefined) {
		if (parseUrlConditions(search.urlConditions)) output.urlConditions = search.urlConditions as string;
		else output.invalidFilters = true;
	}
	const page = Number(search.page);
	if (Number.isSafeInteger(page) && page > 0 && page <= 100000) output.page = page;
	if (["query", "impressions", "clicks", "ctr", "position", "aiLikelihood"].includes(String(search.sort)))
		output.sort = search.sort as KeywordSort;
	if (search.direction === "asc" || search.direction === "desc") output.direction = search.direction;
	if (search.gsc === "connected" || search.gsc === "error") output.gsc = search.gsc;
	return output;
}

export function sortKeywordRows(rows: GscRow[], sort: KeywordSort, direction: "asc" | "desc"): GscRow[] {
	if (sort === "aiLikelihood") {
		// Compute once per row, rather than repeating all regexes on every comparator invocation.
		return rows
			.map((row) => ({ row, score: getAiQuestionSignals(row.query).score }))
			.sort(
				(a, b) =>
					(direction === "asc" ? a.score - b.score : b.score - a.score) ||
					b.row.impressions - a.row.impressions ||
					a.row.query.localeCompare(b.row.query, "ja"),
			)
			.map(({ row }) => row);
	}
	return [...rows].sort((a, b) => {
		const order = sort === "query" ? a.query.localeCompare(b.query, "ja") : a[sort] - b[sort];
		return (direction === "asc" ? order : -order) || a.query.localeCompare(b.query, "ja");
	});
}

/** Treat even leading whitespace before spreadsheet formula markers as untrusted. */
export function keywordCsv(rows: GscRow[]): string {
	const cell = (value: string | number) => {
		let text = String(value);
		if (typeof value === "string" && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(text)) text = `'${text}`;
		return `"${text.replaceAll('"', '""')}"`;
	};
	return (
		"\uFEFF" +
		[
			["キーワード", "表示回数", "クリック数", "CTR", "平均掲載順位"],
			...rows.map((row) => [row.query, row.impressions, row.clicks, row.ctr, row.position]),
		]
			.map((row) => row.map(cell).join(","))
			.join("\r\n")
	);
}
