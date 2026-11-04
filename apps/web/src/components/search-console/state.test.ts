import type { GscRow } from "@workspace/lib/search-console";
import { describe, expect, it } from "vitest";
import { keywordCsv, parseUrlConditions, sortKeywordRows, validateKeywordSearch } from "./state";

const row = (query: string, impressions: number): GscRow => ({
	query,
	impressions,
	clicks: 2,
	ctr: 0.02,
	position: 8.5,
});
describe("keyword analysis URL state", () => {
	it("keeps AI questions optional and restores combined filters, sort and pagination", () => {
		expect(validateKeywordSearch({})).toEqual({});
		const conditions = JSON.stringify([
			{ operator: "subtree", value: "https://example.com/jobs/" },
			{ operator: "notContains", value: "/archive/" },
		]);
		expect(
			validateKeywordSearch({
				keyword: "エンジニア",
				aiQuestionsOnly: "true",
				urlConditions: conditions,
				page: "3",
				sort: "clicks",
				direction: "asc",
			}),
		).toEqual({
			keyword: "エンジニア",
			aiQuestionsOnly: true,
			urlConditions: conditions,
			page: 3,
			sort: "clicks",
			direction: "asc",
		});
		expect(parseUrlConditions(conditions)).toHaveLength(2);
	});
	it("marks malformed filters invalid instead of silently requesting all keywords", () => {
		for (const urlConditions of [
			"{",
			"[null]",
			'[{"operator":"regex","value":".*"}]',
			'[{"operator":"contains","value":""}]',
		]) {
			expect(validateKeywordSearch({ urlConditions }).invalidFilters).toBe(true);
		}
		expect(
			parseUrlConditions(JSON.stringify(Array.from({ length: 11 }, () => ({ operator: "contains", value: "jobs" })))),
		).toBeNull();
		expect(validateKeywordSearch({ keyword: 12, aiQuestionsOnly: "yes" }).invalidFilters).toBe(true);
	});
	it("constrains page and sort values", () => {
		expect(validateKeywordSearch({ page: -1, sort: "unsafe", direction: "other" })).toEqual({});
	});
});
describe("retrieved keyword results", () => {
	it("sorts the complete retrieved dataset before pagination without mutating cached rows", () => {
		const rows = [row("b", 10), row("a", 30), row("c", 20)];
		expect(sortKeywordRows(rows, "impressions", "desc").map((item) => item.query)).toEqual(["a", "c", "b"]);
		expect(sortKeywordRows(rows, "query", "asc").map((item) => item.query)).toEqual(["a", "b", "c"]);
		expect(rows[0].query).toBe("b");
	});
	it("ranks regex signals before volume, breaks ties by impressions, and restores the sort from the URL", () => {
		const rows = [row("あ".repeat(14), 10000), row("案件を教えて", 1), row("仕事を探して", 20), row("a b c d", 500)];
		expect(sortKeywordRows(rows, "aiLikelihood", "desc").map((item) => item.query)).toEqual([
			"仕事を探して",
			"案件を教えて",
			"a b c d",
			"あ".repeat(14),
		]);
		expect(sortKeywordRows(rows, "aiLikelihood", "asc")[0].query).toBe("あ".repeat(14));
		expect(rows[0].impressions).toBe(10000);
		expect(validateKeywordSearch({ sort: "aiLikelihood", direction: "desc" })).toEqual({
			sort: "aiLikelihood",
			direction: "desc",
		});
	});
	it("exports fractional CTR and safely escapes spreadsheet formulas, quotes and newlines", () => {
		const csv = keywordCsv([
			row('=HYPERLINK("https://example.com")', 100),
			row("  +SUM(1,2)", 100),
			row("質問\n次の行", 100),
		]);
		expect(csv.startsWith("\uFEFF")).toBe(true);
		expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
		expect(csv).toContain('"\'  +SUM(1,2)"');
		expect(csv).toContain('"質問\n次の行"');
		expect(csv).toContain('"0.02"');
	});
});
