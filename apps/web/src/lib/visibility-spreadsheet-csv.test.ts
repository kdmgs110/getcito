import { describe, expect, it, vi } from "vitest";
import type { SpreadsheetAnswer, VisibilitySpreadsheetRow } from "./visibility-spreadsheet";
import {
	collectSpreadsheetCsv,
	quoteCsv,
	spreadsheetBrands,
	spreadsheetCsvRow,
	spreadsheetEvidence,
	spreadsheetQueries,
} from "./visibility-spreadsheet-csv";
import { coerceVisibilityView } from "./visibility-view";

const answer: SpreadsheetAnswer = {
	runId: "run",
	createdAt: "2026-01-01T00:00:00Z",
	answerText: '全文, "引用"\n2行目',
	answerStatus: "shown",
	mentionedBrands: ["ブランド"],
	webQueries: [],
	queryStatus: "not_exposed",
	searchResultsStatus: "unknown",
	citationsStatus: "unknown",
	pages: [{ url: "https://example.com/page", domain: "example.com", title: "ページ", appearances: null, citations: 1 }],
	domains: [{ domain: "example.com", appearances: null, citations: 1 }],
};
const row = (id: string): VisibilitySpreadsheetRow => ({
	id,
	value: `プロンプト${id}`,
	tags: ["フルリモート", "高単価"],
	lastRunAt: answer.createdAt,
	chatgpt: answer,
	aiMode: null,
});

describe("spreadsheet CSV", () => {
	it("exports globally ordered rank, category and basis for both stored AI answers", () => {
		const ranked: SpreadsheetAnswer = {
			...answer,
			mentionAnalysis: {
				version: 1,
				coverage: "detected",
				mentions: [
					{
						key: "competitor:other",
						entityId: "other",
						name: "競合",
						kind: "competitor",
						rank: 1,
						rankBasis: "explicit",
						firstOffset: 0,
						evidence: "1. 競合",
						matchedText: "競合",
					},
					{
						key: "own:ours",
						entityId: "ours",
						name: "自社名",
						kind: "own",
						rank: 2,
						rankBasis: "explicit",
						firstOffset: 6,
						evidence: "2. 自社名",
						matchedText: "自社名",
					},
					{
						key: "unregistered:new",
						entityId: null,
						name: "未登録名",
						kind: "unregistered",
						rank: 3,
						rankBasis: "explicit",
						firstOffset: 13,
						evidence: "3. 未登録名",
						matchedText: "未登録名",
					},
				],
			},
		};
		expect(spreadsheetBrands(ranked)).toBe(
			"1位 | 競合 | 競合 | 回答内順位\n2位 | 自社名 | 自社 | 回答内順位\n3位 | 未登録名 | 未登録 | 回答内順位",
		);
		const csv = spreadsheetCsvRow({ ...row("1"), chatgpt: ranked, aiMode: ranked }, "domain");
		expect(csv.match(/3位 \| 未登録名 \| 未登録/g)).toHaveLength(2);
		const mention = ranked.mentionAnalysis?.mentions[0];
		if (!mention) throw new Error("Missing test mention");
		expect(
			spreadsheetBrands({
				...ranked,
				mentionAnalysis: {
					version: 1,
					coverage: "detected",
					mentions: [{ ...mention, url: "https://example.com/jobs/123" }],
				},
			}),
		).toBe("1位 | 競合 | 競合 | 回答内順位 | https://example.com/jobs/123");
		expect(
			spreadsheetBrands({
				...ranked,
				mentionAnalysis: {
					version: 1,
					coverage: "detected",
					mentions: [
						{ ...mention, rank: 1, rankBasis: "appearance" },
						{ ...mention, key: "second", rank: null, rankBasis: "unknown" },
					],
				},
			}),
		).toContain("登場順（検出ブランド内）\n判定不可");
	});
	it("rejects an export if a recount publishes between batches", async () => {
		const ids = Array.from({ length: 21 }, (_, i) => String(i));
		let call = 0;
		await expect(
			collectSpreadsheetCsv({
				promptIds: ids,
				mode: "domain",
				fetchBatch: async (batch) => ({
					rows: batch.map(row),
					asOf: answer.createdAt,
					mentionRevision: ++call === 1 ? "before" : "after",
				}),
			}),
		).rejects.toThrow("Mention results changed");
		await expect(
			collectSpreadsheetCsv({
				promptIds: ["1"],
				mode: "domain",
				mentionRevision: "table-before",
				fetchBatch: async (batch) => ({ rows: batch.map(row), asOf: answer.createdAt, mentionRevision: "after" }),
			}),
		).rejects.toThrow("Mention results changed");
	});
	it("quotes commas, multiline text and double quotes without losing full answers", () => {
		expect(quoteCsv('全文, "引用"\n2行目')).toBe('"全文, ""引用""\n2行目"');
		const csv = spreadsheetCsvRow(row("1"), "domain");
		expect(csv).toContain('"フルリモート\n高単価"');
		expect(csv).toContain('"全文, ""引用""\n2行目"');
		expect(csv.endsWith("\r\n")).toBe(true);
	});
	it.each([
		"=SUM(1)",
		"+CMD",
		"-CMD",
		"@SUM",
		"  =SUM(1)",
		"\tformula",
		"\rformula",
		"\nformula",
	])("neutralizes spreadsheet formulas: %j", (value) => {
		expect(quoteCsv(value)).toBe(`"'${value}"`);
	});
	it("preserves absent evidence as unknown instead of converting it to zero", () => {
		expect(spreadsheetQueries(answer)).toBe("未記録");
		expect(spreadsheetQueries({ ...answer, queryStatus: "observed" })).toContain("検索クエリなし");
		expect(spreadsheetQueries({ ...answer, queryStatus: "not_used" })).toBe("ウェブ検索未使用");
		expect(spreadsheetEvidence(answer, "domain")).toBe("example.com | 出現: 未記録 | 引用: 1");
		expect(spreadsheetEvidence(answer, "page")).toContain("https://example.com/page");
		expect(spreadsheetCsvRow(row("1"), "domain")).toContain("期間内の取得結果なし");
	});
	it("exports every matching ID in stable order and shares snapshot across batches", async () => {
		const ids = Array.from({ length: 45 }, (_, i) => String(i));
		const fetchBatch = vi.fn(async (batch: string[]) => ({
			rows: [...batch].reverse().map(row),
			asOf: answer.createdAt,
		}));
		const progress = vi.fn();
		const blob = await collectSpreadsheetCsv({ promptIds: ids, mode: "domain", fetchBatch, onProgress: progress });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
		const csv = await blob.text();
		expect(fetchBatch.mock.calls.map(([batch]) => batch.length)).toEqual([20, 20, 5]);
		expect(fetchBatch.mock.calls[1]).toEqual([ids.slice(20, 40), answer.createdAt]);
		expect(csv.indexOf('"プロンプト0"')).toBeLessThan(csv.indexOf('"プロンプト1"'));
		expect(csv).toContain('"プロンプト44"');
		expect(progress).toHaveBeenLastCalledWith(45);
	});
	it("fails without returning a partial CSV when a later request fails or scope changes", async () => {
		const ids = Array.from({ length: 21 }, (_, i) => String(i));
		const failed = vi
			.fn()
			.mockResolvedValueOnce({ rows: ids.slice(0, 20).map(row), asOf: answer.createdAt })
			.mockRejectedValueOnce(new Error("network"));
		await expect(collectSpreadsheetCsv({ promptIds: ids, mode: "domain", fetchBatch: failed })).rejects.toThrow(
			"network",
		);
		await expect(
			collectSpreadsheetCsv({
				promptIds: ["deleted"],
				mode: "domain",
				fetchBatch: async () => ({ rows: [], asOf: answer.createdAt }),
			}),
		).rejects.toThrow("scope changed");
	});
	it("cancels between batches without starting another request", async () => {
		const controller = new AbortController();
		const fetchBatch = vi.fn(async (ids: string[]) => {
			controller.abort();
			return { rows: ids.map(row), asOf: answer.createdAt };
		});
		await expect(
			collectSpreadsheetCsv({
				promptIds: Array.from({ length: 21 }, (_, i) => String(i)),
				mode: "page",
				fetchBatch,
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(fetchBatch).toHaveBeenCalledTimes(1);
	});
	it("only accepts the known view URL values", () => {
		expect(coerceVisibilityView("spreadsheet")).toBe("spreadsheet");
		for (const value of ["compare", "bad", {}, 1, undefined]) expect(coerceVisibilityView(value)).toBe("graph");
	});
});
