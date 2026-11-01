import { describe, expect, it } from "vitest";
import { buildPageEvidenceResponse, type PageEvidenceReadRecord } from "./page-evidence-response";
const row = (
	id: string,
	targetKey = "chatgpt:dataforseo-scraper:online",
	languageCode = "ja",
	countryCode = "JP",
): PageEvidenceReadRecord => ({
	id,
	runId: id,
	attemptId: id,
	targetKey,
	provider: targetKey.includes("brightdata") ? "brightdata" : "dataforseo-scraper",
	model: "chatgpt",
	createdAt: "2026-11-01T00:00:00Z",
	requestContext: { version: 1, prompt: "test", targetLanguage: null, targetMarket: null, languageCode, countryCode },
	queries: ["Rails 案件"],
	queryEvidence: [],
});
describe("page evidence exact scope", () => {
	it("selects one provider and locale instead of combining all language/provider results", () => {
		const result = buildPageEvidenceResponse(
			[row("a"), row("b", "chatgpt:brightdata:online"), row("c", undefined, "en", "US"), row("a")],
			{ language: "all" },
		);
		expect(result.selectedRecords.map((r) => r.id)).toEqual(["a"]);
		expect(result.scopes).toHaveLength(2);
		expect(result.queries[0].answers).toHaveLength(1);
		expect(result.queries[0].relations).toEqual([]);
	});
	it("honors model link and exact answer and never falls back on a mismatched target", () => {
		const rows = [row("a"), row("b", "chatgpt:brightdata:online")];
		expect(
			buildPageEvidenceResponse(rows, { model: "chatgpt:brightdata:online" }).selectedRecords.map((r) => r.id),
		).toEqual(["b"]);
		expect(buildPageEvidenceResponse(rows, { attemptId: "b" }).selectedRecords.map((r) => r.id)).toEqual(["b"]);
		expect(buildPageEvidenceResponse(rows, { attemptId: "b", targetKey: rows[0].targetKey }).selectedRecords).toEqual(
			[],
		);
	});
	it("requires exact captured language-country combination and only exposes explicit query relations", () => {
		const a = row("a"),
			b = row("b", undefined, "ja", "US");
		a.queryEvidence = [
			{
				query: "Rails 案件",
				sourceField: "queries.results",
				urls: [{ url: "https://example.com", role: "search_result" }],
			},
		];
		const result = buildPageEvidenceResponse([a, b], { scopeKey: JSON.stringify(["ja", "US"]) });
		expect(result.selectedRecords.map((r) => r.id)).toEqual(["b"]);
		expect(result.country).toBe("US");
		expect(result.queries[0].relations).toEqual([]);
	});
});
