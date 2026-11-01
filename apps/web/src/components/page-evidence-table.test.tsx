import type { PageEvidenceAggregate, PageEvidenceRow } from "@workspace/lib/page-evidence";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageEvidenceTable } from "./page-evidence-table";

const row = (overrides: Partial<PageEvidenceRow> = {}): PageEvidenceRow => ({
	key: "https://example.com/article",
	url: "https://example.com/article",
	title: "ページ名",
	domain: "example.com",
	displayDomain: "example.com",
	searchAnswers: 7,
	searchOccurrences: 12,
	citationAnswers: 3,
	transitionAnswers: 3,
	transitionSearchAnswers: 7,
	searchOnlyAnswers: 4,
	history: [
		{
			id: "answer",
			attemptId: "attempt",
			runId: "run",
			targetKey: "chatgpt:dataforseo-scraper:online",
			createdAt: "2026-11-01T00:00:00Z",
			provider: "dataforseo-scraper",
			model: "chatgpt",
			searchPresent: true,
			searchOccurrences: 2,
			cited: true,
		},
	],
	...overrides,
});
const aggregate = (rows: PageEvidenceRow[], overrides: Partial<PageEvidenceAggregate> = {}): PageEvidenceAggregate => ({
	totalAnswers: 10,
	searchAnswers: 10,
	citationAnswers: 10,
	commonAnswers: 10,
	rows,
	...overrides,
});
const render = (value: PageEvidenceAggregate) =>
	renderToStaticMarkup(<PageEvidenceTable pages={value} domains={value} onAnswer={() => {}} />);

describe("page evidence metrics", () => {
	it("renders answer deduplication counts separately from raw search entries and same-answer conversion", () => {
		const html = render(aggregate([row()]));
		expect(html).toContain("7 / 10回答");
		expect(html).toContain("延べ12件（重複含む）");
		expect(html).toContain("3 / 10回答");
		expect(html).toContain("3 / 7回答");
		expect(html).toContain("42.9%");
		expect(html).toContain("ページ名");
		expect(html).toContain('href="https://example.com/article" target="_blank" rel="noopener noreferrer"');
		expect(html).toContain('aria-expanded="false"');
	});
	it("uses independent coverage denominators and does not turn missing search data into zero", () => {
		const html = render(
			aggregate([row({ searchAnswers: 0, searchOccurrences: 0, transitionSearchAnswers: 0 })], {
				searchAnswers: 0,
				citationAnswers: 8,
				commonAnswers: 0,
			}),
		);
		expect(html).toContain("検索結果取得 0/10回答");
		expect(html).toContain("参照元取得 8/10回答");
		expect(html).toContain("未提供");
		expect(html).toContain("3 / 8回答");
		expect(html).not.toContain("0 / 0回答");
		expect(html).not.toContain("延べ0件");
		expect(html).not.toContain("NaN");
	});
	it("sorts by citation answers before search answers and safely escapes untrusted titles", () => {
		const html = render(
			aggregate([
				row({ key: "b", title: "More searched", searchAnswers: 9, citationAnswers: 1 }),
				row({ key: "a", title: "<script>unsafe</script>", citationAnswers: 4, url: "javascript:alert(1)" }),
			]),
		);
		expect(html.indexOf("&lt;script&gt;unsafe&lt;/script&gt;")).toBeLessThan(html.indexOf("More searched"));
		expect(html).not.toContain('href="javascript:');
		expect(html).toContain('aria-sort="descending"');
	});
	it("provides pagination when more than ten pages match", () => {
		const html = render(aggregate(Array.from({ length: 12 }, (_, i) => row({ key: `url-${i}`, title: `Page ${i}` }))));
		expect(html).toContain("全12件中 1〜10件");
		expect(html).toContain("12");
		expect(html).not.toContain("Page 9"); // stable default sorting uses key after tied metrics
	});
});
