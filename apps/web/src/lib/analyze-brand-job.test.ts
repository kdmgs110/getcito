import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), send: vi.fn(), cancel: vi.fn() }));
vi.mock("@workspace/lib/db/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/lib/boss-client", () => ({ getBoss: async () => ({ send: mocks.send, cancel: mocks.cancel }) }));

import { analysisLocaleKey, enqueueAnalyzeBrand, getAnalyzeBrandStatus } from "./analyze-brand-job";

const dialect = new PgDialect();
const ja = { targetLanguage: "Japanese", targetMarket: "Japan" };
const en = { targetLanguage: "English", targetMarket: "Japan" };
beforeEach(() => {
	vi.clearAllMocks();
	mocks.execute.mockResolvedValue({ rows: [] });
});

describe("analysis job locale isolation", () => {
	it("normalizes equivalent locale representations for cache identity", () => {
		expect(analysisLocaleKey({ targetLanguage: "ja-JP", targetMarket: "JP" })).toBe(analysisLocaleKey(ja));
		expect(analysisLocaleKey(en)).not.toBe(analysisLocaleKey(ja));
	});
	it("does not reuse an English job or return an old English result for Japanese", async () => {
		const oldEnglish = { id: "old", state: "completed", output: { suggestedPrompts: [{ prompt: "best jobs" }] } };
		mocks.execute.mockImplementation(async (query) => {
			const sql = dialect.sqlToQuery(query);
			expect(sql.sql).toContain("data->>'localeKey'");
			return { rows: sql.params.includes(analysisLocaleKey(en)) ? [oldEnglish] : [] };
		});
		await expect(getAnalyzeBrandStatus("rails", ja)).resolves.toEqual({ status: "pending" });
		await enqueueAnalyzeBrand({ brandId: "rails", website: "rails.example.com", ...ja });
		expect(mocks.send).toHaveBeenCalledWith(
			"analyze-brand",
			expect.objectContaining({ ...ja, localeKey: analysisLocaleKey(ja) }),
		);
		await expect(getAnalyzeBrandStatus("rails", en)).resolves.toMatchObject({
			status: "done",
			suggestion: oldEnglish.output,
		});
	});
	it("deduplicates only an in-flight job for the same domain and locale", async () => {
		mocks.execute.mockResolvedValue({
			rows: [{ id: "current", state: "active", data: { website: "https://rails.example.com/" } }],
		});
		await enqueueAnalyzeBrand({ brandId: "rails", website: "rails.example.com", ...ja });
		expect(mocks.send).not.toHaveBeenCalled();
	});
});
