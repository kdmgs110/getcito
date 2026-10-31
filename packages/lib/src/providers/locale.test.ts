import { describe, expect, it } from "vitest";
import { localeCountryCode, localeSystemMessages, localeSystemPrompt } from "./locale";

describe("localeSystemPrompt", () => {
	it("returns undefined when the brand set no market or language", () => {
		expect(localeSystemPrompt()).toBeUndefined();
		expect(localeSystemPrompt({})).toBeUndefined();
		expect(localeSystemPrompt({ webSearch: true })).toBeUndefined();
	});

	it("mentions only the fields that are set", () => {
		expect(localeSystemPrompt({ targetLanguage: "German" })).toBe("Please provide your response in language: German.");
		expect(localeSystemPrompt({ targetMarket: "Germany" })).toBe("Assume the user's location is: Germany.");
	});

	it("combines both when the brand set both", () => {
		expect(localeSystemPrompt({ targetMarket: "Germany", targetLanguage: "German" })).toBe(
			"Please provide your response in language: German. Assume the user's location is: Germany.",
		);
	});
});

describe("localeSystemMessages", () => {
	it("is empty when there is no locale, so no system turn is sent", () => {
		expect(localeSystemMessages({})).toEqual([]);
	});

	it("is a single system message when there is one", () => {
		expect(localeSystemMessages({ targetMarket: "India" })).toEqual([
			{ role: "system", content: "Assume the user's location is: India." },
		]);
	});
});

describe("localeCountryCode", () => {
	it("maps every market the UI offers to an uppercase ISO-2 code", () => {
		expect(localeCountryCode({ targetMarket: "India" })).toBe("IN");
		expect(localeCountryCode({ targetMarket: "United Kingdom" })).toBe("GB");
	});

	it("is undefined only for an unset market and rejects unknown explicit settings", () => {
		expect(localeCountryCode({})).toBeUndefined();
		expect(() => localeCountryCode({ targetMarket: "Atlantis" })).toThrow("BRAND_MARKET_INVALID");
	});
});
