import { BRIGHTDATA_COUNTRIES } from "./brightdata-locations";
import { DATAFORSEO_LANGUAGES } from "./languages";
import { TARGET_MARKETS } from "./locations";

export interface BrandLocaleInput {
	targetLanguage?: string | null;
	targetMarket?: string | null;
}
export interface BrandLocale {
	languageCode?: string;
	languageName?: string;
	countryCode?: string;
	countryName?: string;
}

/** Resolve persisted names and API/BCP-47 codes without silently changing locale. */
export function resolveBrandLocale(input: BrandLocaleInput = {}): BrandLocale {
	const result: BrandLocale = {};
	const language = input.targetLanguage?.trim();
	if (language) {
		const normalized = language.replaceAll("_", "-").toLowerCase();
		let match = DATAFORSEO_LANGUAGES.find(
			(item) => item.name.toLowerCase() === normalized || item.code.toLowerCase() === normalized,
		);
		if (!match) {
			try {
				const baseLanguage = new Intl.Locale(normalized).language;
				match = DATAFORSEO_LANGUAGES.find((item) => item.code.toLowerCase() === baseLanguage);
			} catch {
				throw new Error("BRAND_LANGUAGE_INVALID");
			}
		}
		if (!match) throw new Error("BRAND_LANGUAGE_INVALID");
		result.languageCode = match.code;
		result.languageName = match.name;
	}
	const market = input.targetMarket?.trim();
	if (market) {
		const code =
			BRIGHTDATA_COUNTRIES[market] ??
			Object.entries(BRIGHTDATA_COUNTRIES).find(([name]) => name.toLowerCase() === market.toLowerCase())?.[1] ??
			(/^[a-z]{2}$/i.test(market) ? market.toUpperCase() : undefined);
		const canonical = code
			? TARGET_MARKETS.find((name) => BRIGHTDATA_COUNTRIES[name].toUpperCase() === code.toUpperCase())
			: undefined;
		if (!code || !canonical) throw new Error("BRAND_MARKET_INVALID");
		result.countryCode = code.toUpperCase();
		result.countryName = canonical;
	}
	return result;
}

/** Preserve the established database/provider name representation. */
export function normalizeBrandLocale(input: BrandLocaleInput = {}): {
	targetLanguage: string | null;
	targetMarket: string | null;
} {
	const locale = resolveBrandLocale(input);
	return { targetLanguage: locale.languageName ?? null, targetMarket: locale.countryName ?? null };
}
