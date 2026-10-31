/**
 * Brand locale hint shared by the direct-LLM providers.
 *
 * A brand's target market/language lives on the brand row and is forwarded by
 * the worker on every run (`ProviderOptions.targetMarket` / `targetLanguage`,
 * see apps/worker/src/jobs/process-prompt.ts). Scraper providers hand it to the
 * upstream API using engine-specific country/language fields. Chat-completion
 * endpoints also need a system message to select the response language. Providers that skip this silently run every brand in the
 * model's default locale.
 *
 * Returns undefined when the brand set neither value, so a brand that never
 * picked a market keeps the model's own default instead of being pinned to one.
 */
import { type BrandLocaleInput, resolveBrandLocale } from "../brand-locale";
import type { ProviderOptions } from "./types";

export function localeSystemPrompt(options?: BrandLocaleInput | ProviderOptions): string | undefined {
	const locale = resolveBrandLocale(options);
	const parts: string[] = [];
	if (locale.languageName) parts.push(`Please provide your response in language: ${locale.languageName}.`);
	if (locale.countryName) parts.push(`Assume the user's location is: ${locale.countryName}.`);
	return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The same hint as an OpenAI-style `messages` prefix — spread into the array so
 * it disappears entirely when the brand has no locale set.
 */
export function localeSystemMessages(
	options?: BrandLocaleInput | ProviderOptions,
): Array<{ role: "system"; content: string }> {
	const content = localeSystemPrompt(options);
	return content ? [{ role: "system", content }] : [];
}

/**
 * The brand's target market as an ISO-3166-1 alpha-2 code, for the *search
 * tools* rather than the prompt.
 *
 * A system message steers what the model writes; it does not move where the
 * model searches from. OpenAI's and Anthropic's web-search tools localize
 * results by the caller's IP unless given an approximate user location — which
 * is why a worker hosted in India returns city-level local results no matter
 * what the prompt says. Reuses the country table the BrightData provider
 * already ships (every UI location in locations.ts has an entry).
 *
 * Returns undefined for an unset market; rejects an unrecognized explicit setting.
 */
export function localeCountryCode(options?: BrandLocaleInput | ProviderOptions): string | undefined {
	return resolveBrandLocale(options).countryCode;
}
