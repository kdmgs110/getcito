import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PromptMeasurementRecord } from "@/lib/prompt-measurements";
import { measurementEvidenceFallback } from "@/lib/prompt-measurements";

vi.mock("@/server/prompt-measurements", () => ({
	getPromptMeasurementsFn: vi.fn(),
	getPromptMeasurementDetailFn: vi.fn(),
}));

import { measurementQueryWords, PromptMeasurementCard, PromptMeasurementEvidence } from "./prompt-measurements";

const record = (overrides: Partial<PromptMeasurementRecord> = {}): PromptMeasurementRecord => ({
	id: "attempt",
	attemptId: "attempt",
	runId: "run",
	targetKey: "chatgpt:brightdata:online",
	model: "chatgpt",
	provider: "brightdata",
	version: "web",
	status: "succeeded",
	createdAt: "2026-11-01T01:00:00Z",
	completedAt: "2026-11-01T01:01:00Z",
	requestContext: {
		version: 1,
		prompt: "案件を比較して",
		targetLanguage: "Japanese",
		targetMarket: "Japan",
		languageCode: "ja",
		countryCode: "JP",
	},
	evidence: measurementEvidenceFallback("日本語の回答です。", ["Rails 案件"], true),
	queries: ["Rails 案件"],
	citations: [{ url: "https://example.com/answer", title: "回答の参照元" }],
	...overrides,
});

describe("measurement response cards", () => {
	it("distinguishes failed, running, absent Overview, and unmeasured states", () => {
		const card = (value?: PromptMeasurementRecord) =>
			renderToStaticMarkup(<PromptMeasurementCard label="Google AI Overview" configured record={value} />);
		expect(card()).toContain("未計測");
		expect(card(record({ status: "running" }))).toContain("取得中");
		expect(card(record({ status: "failed" }))).toContain("取得失敗");
		const absent = card(
			record({ runId: null, evidence: { ...measurementEvidenceFallback("", [], true), answerStatus: "not_shown" } }),
		);
		expect(absent).toContain("AI Overview非表示");
		expect(absent).not.toContain("この対象の取得に失敗");
	});
	it("shows original request locale, body, provider, title/full URL and safe new-tab links", () => {
		const html = renderToStaticMarkup(
			<PromptMeasurementCard
				label="ChatGPT Web"
				configured
				record={record({
					evidence: measurementEvidenceFallback(
						"[参考](https://example.com/reference) [危険](javascript:alert(1))",
						[],
						true,
					),
					citations: [
						{ url: "https://example.com/answer", title: "参照ページ名" },
						{ url: "javascript:alert(1)", title: "危険URL" },
					],
				})}
				rawOutput={
					<details>
						<summary>元の出力</summary>raw fixture
					</details>
				}
			/>,
		);
		expect(html).toContain("brightdata");
		expect(html).toContain("日本語");
		expect(html).toContain("案件を比較して");
		expect(html).toContain("参照ページ名");
		expect(html).toContain("https://example.com/answer");
		expect(html).toContain('target="_blank" rel="noopener noreferrer"');
		expect(html).not.toContain('href="javascript:');
		expect(html).not.toContain("危険URL");
		expect(html).toContain("元の出力");
	});
	it("reports unexposed searches without claiming that no search occurred", () => {
		const html = renderToStaticMarkup(
			<PromptMeasurementCard
				label="ChatGPT Web"
				configured
				record={record({ queries: [], evidence: measurementEvidenceFallback("回答", [], true) })}
			/>,
		);
		expect(html).toContain("取得元から未提供");
		expect(html).toContain("検索なしを意味するものではありません");
	});
	it("labels provider-confirmed unused search without claiming the request disabled search", () => {
		const html = renderToStaticMarkup(
			<PromptMeasurementCard
				label="ChatGPT Web"
				configured
				record={record({
					queries: [],
					evidence: { ...measurementEvidenceFallback("回答", [], true), queryStatus: "not_used" },
				})}
			/>,
		);
		expect(html).toContain("ウェブ検索未使用");
		expect(html).not.toContain("ウェブ検索なしの設定");
		expect(html).not.toContain("検索なしを意味するものではありません");
	});
});

describe("exact-answer query evidence", () => {
	it("retains a provider-observed search matching the original question verbatim", () => {
		const query = "案件を比較して";
		const html = renderToStaticMarkup(
			<PromptMeasurementEvidence
				record={record({
					queries: [query],
					evidence: {
						...measurementEvidenceFallback("回答", [query], true),
						queryEvidence: [
							{
								query,
								sourceField: "search_steps[0].results",
								urls: [{ url: "https://example.com/verbatim-search", title: "実際の検索結果", role: "search_result" }],
							},
						],
					},
				})}
			/>,
		);
		const queryDetails = html.slice(html.indexOf("<details"), html.indexOf("</details>") + 10);
		expect(queryDetails).toContain(query);
		expect(queryDetails).toContain("https://example.com/verbatim-search");
		expect(queryDetails).toContain("実際の検索結果");
		expect(queryDetails).toContain("search_steps[0].results");
		expect(html).not.toContain("取得元から未提供");
		expect(html).not.toContain("検索なしを意味するものではありません");
	});
	it("never puts answer-wide sources underneath queries lacking explicit URL evidence", () => {
		const html = renderToStaticMarkup(<PromptMeasurementEvidence record={record()} />);
		const queryDetails = html.slice(html.indexOf("<details"), html.indexOf("</details>") + 10);
		expect(queryDetails).toContain("Rails 案件");
		expect(queryDetails).toContain("対応は、取得元から提供されていません");
		expect(queryDetails).not.toContain("https://example.com/answer");
		expect(html).toContain("回答全体の参照ページ");
	});
	it("expands only explicit query URL relationships and keeps unrelated sources separate", () => {
		const html = renderToStaticMarkup(
			<PromptMeasurementEvidence
				record={record({
					evidence: {
						...measurementEvidenceFallback("回答", ["Rails 案件"], true),
						queryEvidence: [
							{
								query: "Rails 案件",
								sourceField: "search_steps[0].results",
								urls: [{ url: "https://example.com/query", title: "検索結果ページ", role: "search_result" }],
							},
						],
					},
				})}
			/>,
		);
		const queryDetails = html.slice(html.indexOf("<details"), html.indexOf("</details>") + 10);
		expect(queryDetails).toContain("https://example.com/query");
		expect(queryDetails).toContain("検索結果ページ");
		expect(queryDetails).toContain("search_steps[0].results");
		expect(queryDetails).not.toContain("https://example.com/answer");
	});
	it("retains Japanese query words", () => {
		expect(measurementQueryWords(["Rails 案件 日本語", "Rails 案件"])).toEqual(
			expect.arrayContaining(["rails", "案件", "日本語"]),
		);
	});
});
