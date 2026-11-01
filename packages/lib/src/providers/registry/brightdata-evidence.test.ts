import { describe, expect, it } from "vitest";
import { normalizeBrightDataEvidence } from "./brightdata-evidence";

describe("BrightData observable evidence", () => {
	it("extracts AIO markdown and aio_citations instead of organic SERP links", () => {
		const result = normalizeBrightDataEvidence(
			{
				aio_text: "概要",
				aio_markdown: "**概要**",
				aio_citations: [
					{ url: "https://www.example.com/guide", title: "ガイド" },
					{ link: "https://www.example.com/guide", title: "重複" },
					{ url: "javascript:alert(1)" },
					{ url: "https://username:password@example.com/private" },
				],
				organic: [{ url: "https://organic.example/" }],
				related: [{ query: "関連検索はファンアウトではない" }],
				keyword: "元の質問",
			},
			"google-ai-overview",
			true,
			"元の質問",
		);
		expect(result.measurement).toEqual({
			version: 1,
			answerText: "**概要**",
			answerStatus: "shown",
			queryStatus: "not_exposed",
			queryEvidence: [],
			submittedPrompt: "元の質問",
		});
		expect(result.queries).toEqual([]);
		expect(result.citations).toEqual([
			{ url: "https://www.example.com/guide", title: "ガイド", domain: "example.com", citationIndex: 0 },
		]);
	});

	it.each([
		{ aio_text: null, organic: [] },
		{ aio_text: "", aio_markdown: "  " },
		{ has_ai_overview: false },
		{ general: { search_engine: "google" }, organic: [{ url: "https://example.com/" }] },
	])("distinguishes a known successful search without Overview: %j", (record) => {
		const result = normalizeBrightDataEvidence(record, "google-ai-overview", true);
		expect(result.measurement.answerStatus).toBe("not_shown");
		expect(result.measurement.answerText).toBe("");
		expect(result.citations).toEqual([]);
	});

	it.each([
		{},
		{ organic: [] },
		{ answer_text: "Some other scraper shape" },
		{ aio_text: { unknown: "structure" }, general: { search_engine: "google" }, organic: [] },
		{ aio_text: null, aio_citations: [{ url: "https://example.com/reference" }] },
	])("does not misclassify unknown/incomplete AIO schemas as absence: %j", (record) => {
		expect(() => normalizeBrightDataEvidence(record, "google-ai-overview", true)).toThrow("schema was not recognized");
	});

	it("rejects a scraper error even when the AIO field is empty and hides upstream error text", () => {
		expect(() =>
			normalizeBrightDataEvidence({ aio_text: null, error: "token=private-value" }, "google-ai-overview", true),
		).toThrow("BrightData returned a scraper error record");
	});

	it("does not use raw JSON/protocol response as a ChatGPT answer", () => {
		expect(() =>
			normalizeBrightDataEvidence({ response_raw: '{"secret":"not answer prose"}' }, "chatgpt", true),
		).toThrow("schema was not recognized");
	});

	it("uses exact ChatGPT search strings, never infers query-to-citation relationships", () => {
		const result = normalizeBrightDataEvidence(
			{
				answer_text: "回答",
				web_search_query: ["フリーランス 案件 比較", "Rails 案件", "Rails 案件", 42, "  "],
				citations: [{ url: "https://example.com/cited", title: "引用" }],
				search_sources: [{ url: "https://example.com/uncited-search-result" }],
			},
			"chatgpt",
			true,
		);
		expect(result.queries).toEqual(["フリーランス 案件 比較", "Rails 案件"]);
		expect(result.measurement.queryStatus).toBe("observed");
		expect(result.measurement.queryEvidence).toEqual([]);
		expect(result.citations.map((row) => row.url)).toEqual(["https://example.com/cited"]);
	});

	it("unions direct and metadata queries without dropping metadata after an empty direct array", () => {
		const result = normalizeBrightDataEvidence(
			{ answer_text: "回答", web_search_query: [], metadata: { search_model_queries: { queries: [" 実検索 "] } } },
			"chatgpt",
			true,
		);
		expect(result.queries).toEqual(["実検索"]);
	});

	it("records query URL relationships only when nested under that specific reported query", () => {
		const result = normalizeBrightDataEvidence(
			{
				answer_text: "回答",
				metadata: {
					search_model_queries: {
						queries: [
							{ q: "first", results: [{ url: "https://example.com/first", title: "検索結果" }, "javascript:alert(1)"] },
							{ query: "second", citations: ["https://example.com/second"] },
							{ query: "third" },
						],
					},
				},
				citations: [{ url: "https://example.com/answer-only" }],
			},
			"chatgpt",
			true,
		);
		expect(result.queries).toEqual(["first", "second", "third"]);
		expect(result.measurement.queryEvidence).toEqual([
			{
				query: "first",
				urls: [{ url: "https://example.com/first", title: "検索結果", role: "search_result" }],
				sourceField: "metadata.search_model_queries.queries[].results",
			},
			{
				query: "second",
				urls: [{ url: "https://example.com/second", role: "citation" }],
				sourceField: "metadata.search_model_queries.queries[].citations",
			},
		]);
	});

	it("can extract explicit queries from structured response_raw while keeping answer_text", () => {
		const result = normalizeBrightDataEvidence(
			{
				answer_text: "本文",
				response_raw: JSON.stringify({ metadata: { search_model_queries: ["actual search"] } }),
			},
			"chatgpt",
			true,
		);
		expect(result.measurement.answerText).toBe("本文");
		expect(result.queries).toEqual(["actual search"]);
	});

	it("does not call an empty query array proof that no web search occurred", () => {
		const result = normalizeBrightDataEvidence({ answer_text: "回答", web_search_query: [] }, "chatgpt", true);
		expect(result.measurement.queryStatus).toBe("not_exposed");
	});

	it("does not mistake streaming UI action queries or source groups for executed search keywords", () => {
		const result = normalizeBrightDataEvidence(
			{
				answer_text: "本文",
				web_search_triggered: true,
				web_search_query: null,
				response_raw: JSON.stringify([
					{
						status: {
							reasoning: {
								items: [{ searchSources: { title: "", groups: [{ entries: [{ url: "https://example.com/" }] }] } }],
							},
						},
					},
					{
						dil: {
							appData: {
								opGenui: {
									componentResults: {
										component: {
											state: {
												action_payload: { query: "suggested follow-up" },
												images: [{ image_search_query: "image-only search" }],
											},
										},
									},
								},
							},
						},
					},
				]),
			},
			"chatgpt",
			true,
		);
		expect(result.measurement.queryStatus).toBe("not_exposed");
		expect(result.queries).toEqual([]);
		expect(result.measurement.queryEvidence).toEqual([]);
	});

	it("uses an explicit upstream no-search flag without fabricating a query", () => {
		const result = normalizeBrightDataEvidence({ answer_text: "回答", web_search_triggered: false }, "chatgpt", true);
		expect(result.measurement.queryStatus).toBe("not_used");
		expect(result.queries).toEqual([]);
	});

	it("keeps observed queries if a contradictory no-search flag is returned", () => {
		const result = normalizeBrightDataEvidence(
			{ answer_text: "回答", web_search_triggered: false, web_search_query: ["observed"] },
			"chatgpt",
			true,
		);
		expect(result.measurement.queryStatus).toBe("observed");
	});

	it("does not report requested offline search evidence as an online measurement", () => {
		const result = normalizeBrightDataEvidence(
			{ answer_text: "回答", web_search_query: [{ query: "search", urls: ["https://example.com/"] }] },
			"chatgpt",
			false,
		);
		expect(result.measurement.queryStatus).toBe("not_used");
		expect(result.queries).toEqual([]);
		expect(result.measurement.queryEvidence).toEqual([]);
	});
});
