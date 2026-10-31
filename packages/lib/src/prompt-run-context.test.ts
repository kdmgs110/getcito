import { describe, expect, it } from "vitest";
import { buildPromptRunRequestContext, hasLikelyResponseLanguageMismatch } from "./prompt-run-context";

describe("prompt run request snapshots", () => {
	it("captures canonical requested locale and the original prompt without changing its casing or content", () => {
		const original = "Railsのフリーランス案件を探すには？\n条件を比較したい";
		expect(buildPromptRunRequestContext(original, { targetLanguage: "ja-JP", targetMarket: "JP" })).toEqual({
			version: 1,
			prompt: original,
			targetLanguage: "Japanese",
			targetMarket: "Japan",
			languageCode: "ja",
			countryCode: "JP",
		});
	});
	it("keeps the captured request unchanged when brand settings later change", () => {
		const brand = { targetLanguage: "Japanese", targetMarket: "Japan" };
		const snapshot = buildPromptRunRequestContext("Rails案件", brand);
		brand.targetLanguage = "English";
		brand.targetMarket = "United States";
		expect(snapshot).toMatchObject({ targetLanguage: "Japanese", targetMarket: "Japan", prompt: "Rails案件" });
		expect(buildPromptRunRequestContext("Rails jobs", brand)).toMatchObject({
			targetLanguage: "English",
			languageCode: "en",
			countryCode: "US",
		});
	});
	it("records an explicit unset locale without inventing English or a search country", () => {
		expect(buildPromptRunRequestContext("Rails", {})).toEqual({
			version: 1,
			prompt: "Rails",
			targetLanguage: null,
			targetMarket: null,
		});
	});
	it("rejects an invalid locale before a misleading snapshot can be persisted", () => {
		expect(() => buildPromptRunRequestContext("Rails", { targetLanguage: "not-a-language" })).toThrow();
	});
});

describe("conservative response language warnings", () => {
	const english =
		"Compare the leading freelance platforms and their available opportunities. Choose a service based on your experience and desired working conditions. Review contract terms, payment timing, remote work policies, and support options before making your decision.";
	const japanese =
		"フリーランス案件を探す場合は、希望する働き方と条件を整理しましょう。報酬や契約期間だけでなく、稼働時間やサポート体制の違いを確認することも大切です。自分に合うサービスを選ぶことで案件探しを進めやすくなります。";
	it("warns about substantial non-Japanese prose for a Japanese request and Japanese prose for English", () => {
		expect(hasLikelyResponseLanguageMismatch("ja", english)).toBe(true);
		expect(hasLikelyResponseLanguageMismatch("en", japanese)).toBe(true);
	});
	it("does not mistake ordinary Japanese text with product names or English text for a mismatch", () => {
		expect(hasLikelyResponseLanguageMismatch("ja", `${japanese} React / JavaScript / Rails`)).toBe(false);
		expect(hasLikelyResponseLanguageMismatch("en", english)).toBe(false);
	});
	it("leaves legacy, short, quoted, code-only and unsupported-language results unknown", () => {
		expect(hasLikelyResponseLanguageMismatch(undefined, english)).toBe(false);
		expect(hasLikelyResponseLanguageMismatch("ja", "See Rails jobs")).toBe(false);
		expect(hasLikelyResponseLanguageMismatch("ja", `> ${english}`)).toBe(false);
		expect(hasLikelyResponseLanguageMismatch("ja", `\`\`\`js\n${english}\n\`\`\``)).toBe(false);
		expect(hasLikelyResponseLanguageMismatch("fr", english)).toBe(false);
	});
});
