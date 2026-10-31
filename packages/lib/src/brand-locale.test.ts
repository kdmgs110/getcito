import { describe, expect, it } from "vitest";
import { normalizeBrandLocale, resolveBrandLocale } from "./brand-locale";

describe("brand locale resolution", () => {
	it("keeps the language independent from the market and resolves legacy names and codes", () => {
		expect(resolveBrandLocale({ targetLanguage: "ja-JP", targetMarket: "JP" })).toEqual({
			languageCode: "ja",
			languageName: "Japanese",
			countryCode: "JP",
			countryName: "Japan",
		});
		expect(normalizeBrandLocale({ targetLanguage: "Japanese", targetMarket: "Japan" })).toEqual({
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
		expect(resolveBrandLocale({ targetLanguage: "en", targetMarket: "Japan" })).toMatchObject({
			languageName: "English",
			countryCode: "JP",
		});
		expect(resolveBrandLocale({ targetLanguage: "Japanese" })).toEqual({
			languageCode: "ja",
			languageName: "Japanese",
		});
	});
	it("distinguishes unset settings from unsupported explicit settings", () => {
		expect(resolveBrandLocale({ targetLanguage: null, targetMarket: "" })).toEqual({});
		expect(normalizeBrandLocale()).toEqual({ targetLanguage: null, targetMarket: null });
		expect(() => resolveBrandLocale({ targetLanguage: "Klingon" })).toThrow("BRAND_LANGUAGE_INVALID");
		expect(() => resolveBrandLocale({ targetLanguage: "ja-$$" })).toThrow("BRAND_LANGUAGE_INVALID");
		expect(() => resolveBrandLocale({ targetMarket: "Atlantis" })).toThrow("BRAND_MARKET_INVALID");
	});
});
