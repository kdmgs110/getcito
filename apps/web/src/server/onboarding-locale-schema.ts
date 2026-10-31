import { normalizeBrandLocale } from "@workspace/lib/brand-locale";
import { z } from "zod";

function localeField(field: "targetLanguage" | "targetMarket") {
	return z
		.string()
		.max(100)
		.nullable()
		.optional()
		.refine(
			(value) => {
				try {
					normalizeBrandLocale({ [field]: value });
					return true;
				} catch {
					return false;
				}
			},
			field === "targetLanguage" ? "BRAND_LANGUAGE_INVALID" : "BRAND_MARKET_INVALID",
		);
}

export const onboardingLocaleSchemaFields = {
	targetLanguage: localeField("targetLanguage"),
	targetMarket: localeField("targetMarket"),
};
