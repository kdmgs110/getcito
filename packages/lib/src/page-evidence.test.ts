import { describe, expect, it } from "vitest";
import {
	aggregatePageEvidence,
	normalizeEvidencePage,
	normalizePageEvidence,
	type PageEvidenceAnswer,
	type PageEvidenceField,
} from "./page-evidence";

const page = (url: string) => {
	const result = normalizeEvidencePage({ url, title: "Article" }, "fixture");
	if (!result) throw new Error("Invalid test URL");
	return result;
};
const known = (urls: string[]): PageEvidenceField => ({
	status: "known",
	sourceField: "fixture",
	items: urls.map(page),
});
const unknown = (): PageEvidenceField => ({ status: "unknown", sourceField: "unavailable", items: [] });
const answer = (id: string, search: PageEvidenceField, citations: PageEvidenceField): PageEvidenceAnswer => ({
	id,
	runId: id,
	attemptId: `attempt-${id}`,
	createdAt: "2026-11-01T00:00:00Z",
	targetKey: "chatgpt:dataforseo-scraper:online",
	provider: "dataforseo-scraper",
	model: "chatgpt",
	evidence: { version: 1, search, citations },
});
const A = "https://jobs.example.com/rails/implementation";
const B = "https://career.example.com/jobs/rails-remote";
const C = "https://projects.example.com/ruby-on-rails";

function scraper(search: unknown, sources: unknown, extra: Record<string, unknown> = {}) {
	return {
		status_code: 20000,
		tasks: [{ status_code: 20000, result: [{ markdown: "Answer", search_results: search, sources, ...extra }] }],
	};
}

describe("page evidence normalization", () => {
	it("preserves repeated search records and separates answer-level sources", () => {
		const evidence = normalizePageEvidence(scraper([{ url: A }, { url: A }], [{ url: B }]), {
			provider: "dataforseo-scraper",
			model: "chatgpt",
		});
		expect(evidence.search.status).toBe("known");
		expect(evidence.search.items).toHaveLength(2);
		expect(evidence.citations.items.map((item) => item.url)).toEqual([B]);
		expect(evidence.search.items[0]?.sourceField).toBe("tasks[0].result[0].search_results");
	});
	it("does not turn empty, null, missing or malformed payloads into zero observations", () => {
		for (const raw of [
			scraper([], []),
			scraper(null, null),
			scraper(undefined, undefined),
			"not json",
			{ tasks: [] },
		]) {
			const evidence = normalizePageEvidence(raw, {
				provider: "dataforseo-scraper",
				model: "chatgpt",
				webSearch: true,
			});
			expect(evidence.search.status).toBe("unknown");
			expect(evidence.citations.status).toBe("unknown");
		}
	});
	it("accepts an explicit no-search flag as evidence of empty observations", () => {
		const evidence = normalizePageEvidence(scraper([], [], { web_search_triggered: false }), {
			provider: "dataforseo-scraper",
			model: "chatgpt",
		});
		expect(evidence.search.status).toBe("known");
		expect(evidence.citations.status).toBe("known");
	});
	it("does not use organic results as AI Overview retrievals or citations", () => {
		const evidence = normalizePageEvidence(
			{ organic: [{ url: A }], aio_citations: [{ url: B }] },
			{ provider: "brightdata", model: "google-ai-overview" },
		);
		expect(evidence.search.status).toBe("unknown");
		expect(evidence.search.items).toEqual([]);
		expect(evidence.citations.items.map((item) => item.url)).toEqual([B]);
	});
	it("displays Japanese IDNs while using ASCII host keys", () => {
		const normalized = page("https://Rails案件.com/jobs");
		expect(normalized.domain).toBe(new URL("https://Rails案件.com").hostname);
		expect(normalized.displayDomain).toBe("rails案件.com");
	});
	it("normalizes only safe URL differences and leaves semantic paths, hosts and queries separate", () => {
		const original = "https://WWW.Example.com:443/a/?category=rails&utm_source=ai&gclid=test#section";
		const normalized = page(original);
		expect(normalized.key).toBe("https://www.example.com/a/?category=rails");
		expect(normalized.url).toContain("utm_source=ai");
		expect(normalized.domain).toBe("example.com");
		expect(page("https://example.com/a").key).not.toBe(page("https://example.com/a/").key);
		expect(page("https://sub.example.com/a").domain).toBe("sub.example.com");
		for (const url of [
			"javascript:alert(1)",
			"data:text/html,test",
			"https://user:pass@example.com",
			"/relative",
			"invalid",
		])
			expect(normalizeEvidencePage(url, "test")).toBeNull();
	});
});

describe("page and domain answer aggregation", () => {
	it("matches the v2 acceptance examples without inflating per-answer counts", () => {
		const answers = Array.from({ length: 10 }, (_, i) =>
			answer(
				String(i),
				known([
					...(i < 7 ? [A] : []),
					...(i < 5 ? [A] : []),
					...(i < 4 ? [B] : []),
					...(i === 0 ? [B] : []),
					...(i < 3 ? [C] : []),
				]),
				known([...(i < 3 ? [A, A] : []), ...(i < 2 ? [B] : [])]),
			),
		);
		const result = aggregatePageEvidence(answers);
		expect(result).toMatchObject({ totalAnswers: 10, searchAnswers: 10, citationAnswers: 10, commonAnswers: 10 });
		expect(
			result.rows.map((row) => [
				row.searchAnswers,
				row.searchOccurrences,
				row.citationAnswers,
				row.transitionAnswers,
				row.transitionSearchAnswers,
			]),
		).toEqual([
			[7, 12, 3, 3, 7],
			[4, 5, 2, 2, 4],
			[3, 3, 0, 0, 3],
		]);
		expect(
			(100 * (result.rows[0]?.transitionAnswers ?? 0)) / (result.rows[0]?.transitionSearchAnswers ?? 0),
		).toBeCloseTo(42.857);
	});
	it("uses the shared observed-answer set instead of dividing independent totals", () => {
		const result = aggregatePageEvidence([
			answer("1", known([A]), unknown()),
			answer("2", unknown(), known([A])),
			answer("3", known([A]), known([])),
			answer("4", known([A]), known([A])),
		]);
		expect(result).toMatchObject({ totalAnswers: 4, searchAnswers: 3, citationAnswers: 3, commonAnswers: 2 });
		expect(result.rows[0]).toMatchObject({
			searchAnswers: 3,
			citationAnswers: 2,
			transitionAnswers: 1,
			transitionSearchAnswers: 2,
		});
		expect(result.rows[0]?.history.find((item) => item.id === "1")?.cited).toBeNull();
		expect(result.rows[0]?.history.find((item) => item.id === "2")?.searchPresent).toBeNull();
	});
	it("counts domain answers once despite multiple articles and keeps subdomains distinct", () => {
		const result = aggregatePageEvidence(
			[
				answer(
					"1",
					known(["https://www.example.com/a", "https://example.com/b", "https://sub.example.com/c"]),
					known(["https://example.com/a", "https://example.com/b"]),
				),
			],
			{ groupBy: "domain" },
		);
		expect(result.rows.find((row) => row.domain === "example.com")).toMatchObject({
			searchAnswers: 1,
			searchOccurrences: 2,
			citationAnswers: 1,
			transitionAnswers: 1,
		});
		expect(result.rows).toHaveLength(2);
	});
	it("deduplicates repeated storage of the same run and includes citation-only pages", () => {
		const first = answer("1", known([]), known([A]));
		const result = aggregatePageEvidence([first, { ...first, id: "duplicate-attempt" }]);
		expect(result.totalAnswers).toBe(1);
		expect(result.rows[0]).toMatchObject({ searchAnswers: 0, citationAnswers: 1, transitionSearchAnswers: 0 });
	});
	it("does not classify unknown citation coverage as search-result-only", () => {
		const answers = [answer("1", known([A]), unknown()), answer("2", known([B]), known([]))];
		expect(aggregatePageEvidence(answers, { filter: "search_only" }).rows.map((row) => row.url)).toEqual([B]);
	});
});
