import { describe, expect, it } from "vitest";
import {
	opportunityContextMatches,
	opportunityGenerationContext,
	opportunityLanguageInstruction,
	opportunityLanguageMismatch,
} from "./opportunity-language";

const japanese = opportunityGenerationContext(
	{ targetLanguage: "Japanese", targetMarket: "Japan" },
	"en",
	"Asia/Tokyo",
);
const englishProse =
	"Independent editorial recommendations should describe specific opportunities for prospective customers comparing providers and reviewing the available alternatives across trusted websites and relevant community discussions.";

describe("opportunity generation language", () => {
	it("honors explicit Japanese even when the application fallback is English", () => {
		expect(japanese).toEqual({
			version: 1,
			targetLanguage: "Japanese",
			languageCode: "ja",
			targetMarket: "Japan",
			countryCode: "JP",
			timezone: "Asia/Tokyo",
		});
	});
	it("honors explicit English even when the application fallback is Japanese", () => {
		expect(opportunityGenerationContext({ targetLanguage: "English" }, "ja", "UTC")).toMatchObject({
			targetLanguage: "English",
			languageCode: "en",
			targetMarket: null,
			countryCode: null,
		});
	});
	it.each(["ja", "ja-JP", " ja_JP "])("canonicalizes a persisted language alias %s", (targetLanguage) => {
		expect(opportunityGenerationContext({ targetLanguage, targetMarket: "jp" }, "en", "Asia/Tokyo")).toEqual(japanese);
	});
	it.each(["ja", "en"] as const)("uses application language %s only when no brand language is set", (fallback) => {
		expect(opportunityGenerationContext({ targetLanguage: " " }, fallback, "UTC").languageCode).toBe(fallback);
	});
	it("gives language instructions precedence while preserving prompt text and API schema tokens", () => {
		const instruction = opportunityLanguageInstruction(japanese);
		expect(instruction).toContain("OUTPUT LANGUAGE: Japanese (ja)");
		expect(instruction).toContain(
			"summary bullets, opportunity titles, why explanations, and risk caveats in Japanese",
		);
		expect(instruction).toContain("Japan market");
		expect(instruction).toContain("relatedPrompts exactly as supplied, without translation");
		expect(instruction).toContain("JSON property names and category enum values unchanged");
	});
	it("does not infer a country solely from the output language", () => {
		expect(opportunityLanguageInstruction(opportunityGenerationContext({}, "ja", "UTC"))).toContain(
			"do not assume a country",
		);
	});
	it("requires matching language, market, timezone and context version for cached reports", () => {
		expect(opportunityContextMatches({ ...japanese }, japanese)).toBe(true);
		for (const incompatible of [
			undefined,
			{},
			{ ...japanese, version: 0 },
			{ ...japanese, targetLanguage: "English", languageCode: "en" },
			{ ...japanese, targetMarket: "United States", countryCode: "US" },
			{ ...japanese, timezone: "UTC" },
		]) {
			expect(opportunityContextMatches(incompatible, japanese)).toBe(false);
		}
	});
	it("rejects all-English generated prose for Japanese, excluding unmodified related prompt strings", () => {
		expect(opportunityLanguageMismatch({ summary: [englishProse], opportunities: [], risks: [] }, japanese)).toBe(true);
		expect(
			opportunityLanguageMismatch(
				{
					summary: ["独立した比較サイトで紹介される機会を増やしましょう。"],
					opportunities: [{ title: "比較記事への掲載", why: "競合を紹介する第三者サイトへの働きかけが有効です。" }],
					risks: ["根拠のない推薦は避けましょう。"],
				},
				japanese,
			),
		).toBe(false);
	});
});
