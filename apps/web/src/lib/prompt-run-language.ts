import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

/** `unrecorded` means a legacy run; `unspecified` means a captured, unset request. */
export function isPromptRunLanguageFilter(value: unknown): value is string {
	return (
		typeof value === "string" &&
		(["all", "unrecorded", "unspecified"].includes(value) ||
			DATAFORSEO_LANGUAGES.some((language) => language.code === value))
	);
}

/** One condition shared by run lists, mention totals, citations and fan-out denominators. */
export function promptRunLanguageCondition(context: SQLWrapper, language = "all"): SQL {
	if (!isPromptRunLanguageFilter(language)) throw new Error("Invalid run language filter");
	if (language === "all") return sql`TRUE`;
	if (language === "unrecorded") return sql`${context} IS NULL`;
	if (language === "unspecified") return sql`${context} IS NOT NULL AND ${context}->>'languageCode' IS NULL`;
	return sql`${context}->>'languageCode' = ${language}`;
}
