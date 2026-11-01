import { describe, expect, it } from "vitest";
import {
	isComparisonSurface,
	legacyMeasurementTarget,
	measurementEvidenceFallback,
	observedQueries,
	safeMeasurementCitations,
	safeMeasurementEvidence,
} from "./prompt-measurements";

describe("prompt measurement identity and evidence", () => {
	it("keeps API answers and AI Mode out of the two Web surfaces", () => {
		expect(isComparisonSurface("chatgpt", "brightdata")).toBe(true);
		expect(isComparisonSurface("google-ai-overview", "olostep")).toBe(true);
		for (const provider of ["dataforseo", "direct", "openrouter", "unknown", null]) {
			expect(isComparisonSurface("chatgpt", provider)).toBe(false);
		}
		expect(isComparisonSurface("google-ai-mode", "brightdata")).toBe(false);
	});
	it("does not infer an old run's requested target version from its returned version", () => {
		const target = legacyMeasurementTarget("chatgpt", "brightdata", "gpt-5", true);
		expect(target.requestedVersion).toBeNull();
		expect(target.legacy).toBe(true);
		expect(target.key).not.toBe("chatgpt:brightdata:gpt-5:online");
	});
	it("drops empty and sentinel queries without inventing query-to-URL relationships", () => {
		const queries = observedQueries([" unavailable ", "", null, " Rails 案件 ", "Rails 案件"]);
		expect(queries).toEqual(["Rails 案件"]);
		expect(measurementEvidenceFallback("回答", queries, true).queryEvidence).toEqual([]);
		expect(measurementEvidenceFallback("回答", [], true).queryStatus).toBe("unknown");
		expect(measurementEvidenceFallback("回答", [], false).queryStatus).toBe("not_used");
	});
	it("does not reclassify a malformed legacy sentinel as confirmed Overview absence", () => {
		expect(measurementEvidenceFallback("No Google AI mode invoked.", [], true).answerStatus).toBe("unknown");
		expect(measurementEvidenceFallback("", [], true).answerStatus).toBe("unknown");
	});
	it("rejects unsafe external source URLs and preserves explicit evidence separately", () => {
		const citations = safeMeasurementCitations([
			{ url: "javascript:alert(1)", title: "unsafe" },
			{ url: "https://user:secret@example.com/", title: "secret" },
			{ url: "https://example.com/jobs", title: "Jobs" },
			{ url: "https://example.com/jobs", title: "Duplicate" },
		]);
		expect(citations).toEqual([{ url: "https://example.com/jobs", title: "Jobs" }]);
		const evidence = safeMeasurementEvidence({
			...measurementEvidenceFallback("回答", ["Rails"], true),
			queryEvidence: [
				{
					query: "Rails",
					sourceField: "search_results",
					urls: [
						{ url: "data:text/html,unsafe", role: "visited" },
						{ url: "https://example.com/jobs", role: "search_result" },
					],
				},
			],
		});
		expect(evidence.queryEvidence[0].urls).toEqual([{ url: "https://example.com/jobs", role: "search_result" }]);
		expect(evidence.queryEvidence[0].sourceField).toBe("search_results");
	});
});
