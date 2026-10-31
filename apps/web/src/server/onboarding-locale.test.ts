import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findBrand: vi.fn() }));
vi.mock("@workspace/lib/db/db", () => ({ db: { query: { brands: { findFirst: mocks.findBrand } } } }));

import { z } from "zod";
import { resolveOnboardingLocale } from "./onboarding-locale";
import { onboardingLocaleSchemaFields } from "./onboarding-locale-schema";

beforeEach(() => {
	mocks.findBrand.mockReset().mockResolvedValue({ targetLanguage: "Japanese", targetMarket: "Japan" });
});
describe("onboarding locale resolution", () => {
	it("uses authoritative saved settings when the client omits locale", async () => {
		await expect(resolveOnboardingLocale("rails")).resolves.toEqual({
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
	});
	it("validates an unsaved wizard preview and keeps omitted fields from the saved brand", async () => {
		await expect(resolveOnboardingLocale("rails", { targetLanguage: "en" })).resolves.toEqual({
			targetLanguage: "English",
			targetMarket: "Japan",
		});
		await expect(resolveOnboardingLocale("rails", { targetMarket: null })).resolves.toEqual({
			targetLanguage: "Japanese",
			targetMarket: null,
		});
		await expect(resolveOnboardingLocale("rails", { targetLanguage: "invented language" })).rejects.toThrow(
			"BRAND_LANGUAGE_INVALID",
		);
	});
	it("does not invent settings for a missing brand", async () => {
		mocks.findBrand.mockResolvedValueOnce(undefined);
		await expect(resolveOnboardingLocale("missing")).rejects.toThrow("BRAND_NOT_FOUND");
	});
	it("rejects unsupported locale values at the API validation boundary", () => {
		const schema = z.object(onboardingLocaleSchemaFields);
		expect(schema.safeParse({ targetLanguage: "ja-JP", targetMarket: "JP" }).success).toBe(true);
		expect(schema.safeParse({ targetLanguage: "made up" }).success).toBe(false);
		expect(schema.safeParse({ targetMarket: "Atlantis" }).success).toBe(false);
	});
});
