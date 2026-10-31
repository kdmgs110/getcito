import { resolveBrandLocale } from "./brand-locale";

/** Immutable context supplied to the provider adapter, not a claim about the answer's language. */
export interface PromptRunRequestContext {
	version: 1;
	prompt: string;
	targetLanguage: string | null;
	targetMarket: string | null;
	languageCode?: string;
	countryCode?: string;
}

export function buildPromptRunRequestContext(
	prompt: string,
	locale: { targetLanguage?: string | null; targetMarket?: string | null },
): PromptRunRequestContext {
	const resolved = resolveBrandLocale(locale);
	return {
		version: 1,
		prompt,
		targetLanguage: resolved.languageName ?? null,
		targetMarket: resolved.countryName ?? null,
		...(resolved.languageCode ? { languageCode: resolved.languageCode } : {}),
		...(resolved.countryCode ? { countryCode: resolved.countryCode } : {}),
	};
}

/** Conservative script mismatch warning. Short, mixed or unsupported text stays unknown. */
export function hasLikelyResponseLanguageMismatch(languageCode: string | undefined, text: string): boolean {
	if (!languageCode || !text) return false;
	const prose = text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/^>.*$/gm, " ");
	const kana = prose.match(/[\u3040-\u30ff]/g)?.length ?? 0;
	const cjk = prose.match(/[\u3400-\u9fff]/g)?.length ?? 0;
	const latinWords = prose.match(/[A-Za-z]{2,}/g) ?? [];
	if (languageCode === "ja")
		return kana === 0 && cjk === 0 && latinWords.length >= 20 && latinWords.join("").length >= 120;
	if (languageCode === "en") return kana >= 20 && cjk + kana >= 60 && cjk + kana > latinWords.join("").length;
	return false;
}
