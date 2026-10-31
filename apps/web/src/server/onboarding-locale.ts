import { normalizeBrandLocale } from "@workspace/lib/brand-locale";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";

export interface OnboardingLocaleInput {
	targetLanguage?: string | null;
	targetMarket?: string | null;
}

/** Called only after the caller proves access to this brand. Omission retains stored settings. */
export async function resolveOnboardingLocale(brandId: string, overrides: OnboardingLocaleInput = {}) {
	const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
	if (!brand) throw new Error("BRAND_NOT_FOUND");
	return normalizeBrandLocale({
		targetLanguage: overrides.targetLanguage === undefined ? brand.targetLanguage : overrides.targetLanguage,
		targetMarket: overrides.targetMarket === undefined ? brand.targetMarket : overrides.targetMarket,
	});
}
