import { resolveBrandLocale } from "../../brand-locale";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import { extractCitationsFromDataforseoScraper } from "../../text-extraction";
import type { ModelConfig, Provider, ProviderOptions, ScrapeResult } from "../types";

// LLM Scraper collects ChatGPT's consumer Web surface. It is deliberately a
// different provider from DataForSEO LLM Responses (which calls model APIs).
const ENDPOINT = "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced";
const MAX_PROMPT_CHARACTERS = 2000;
const TIMEOUT_MS = 150_000;

type JsonRecord = Record<string, unknown>;

class DataForSeoScraperError extends Error {}

function object(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function targetError(config: Pick<ModelConfig, "model" | "version">): string | null {
	if (config.model !== "chatgpt") return "DataForSEO LLM Scraper only supports ChatGPT Web";
	if (config.version) return "DataForSEO LLM Scraper does not support selecting a model version";
	return null;
}

function encodeKeyword(prompt: string): string {
	if (!prompt.trim() || Array.from(prompt).length > MAX_PROMPT_CHARACTERS) {
		throw new DataForSeoScraperError("DataForSEO LLM Scraper prompts must contain 1 to 2000 characters");
	}
	// This endpoint URL-decodes keyword values even inside a JSON body. Escape
	// literal percent/plus characters once so C++, 50%, and %20 stay verbatim.
	const encoded = prompt.replaceAll("%", "%25").replaceAll("+", "%2B");
	if (Array.from(encoded).length > MAX_PROMPT_CHARACTERS) {
		throw new DataForSeoScraperError("DataForSEO LLM Scraper encoded prompt exceeds 2000 characters");
	}
	return encoded;
}

/** Normalize a single LLM Scraper response, never inferred query/source edges. */
export function normalizeDataForSeoScraperResponse(payload: unknown, prompt: string, webSearch: boolean): ScrapeResult {
	const response = object(payload);
	const task = Array.isArray(response?.tasks) ? object(response.tasks[0]) : undefined;
	const result = Array.isArray(task?.result) ? object(task.result[0]) : undefined;
	if (response?.status_code !== 20000 || task?.status_code !== 20000 || !result) {
		throw new DataForSeoScraperError("DataForSEO LLM Scraper task did not succeed");
	}
	const answerText = text(result.markdown);
	if (!answerText) throw new DataForSeoScraperError("DataForSEO LLM Scraper returned no answer text");
	const queries =
		webSearch && Array.isArray(result.fan_out_queries)
			? result.fan_out_queries.flatMap((value) => {
					const query = text(value);
					return query ? [query] : [];
				})
			: [];
	return {
		rawOutput: payload,
		textContent: answerText,
		webQueries: webSearch && queries.length === 0 ? [WEB_QUERIES_UNAVAILABLE] : queries,
		citations: extractCitationsFromDataforseoScraper(payload),
		modelVersion: text(result.model),
		measurement: {
			version: 1,
			answerText,
			answerStatus: "shown",
			queryStatus: !webSearch ? "not_used" : queries.length > 0 ? "observed" : "not_exposed",
			// fan_out_queries and answer-level sources do not tell us which
			// particular query retrieved which URL. Keep them separate.
			queryEvidence: [],
			submittedPrompt: prompt,
		},
	};
}

export const dataforseoScraper: Provider = {
	id: "dataforseo-scraper",
	name: "DataForSEO LLM Scraper",
	isConfigured() {
		return !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD;
	},
	validateTarget: targetError,
	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const invalid = targetError({ model, version: options?.version });
		if (invalid) throw new DataForSeoScraperError(invalid);
		const keyword = encodeKeyword(prompt);
		const locale = resolveBrandLocale(options);
		const username = process.env.DATAFORSEO_LOGIN;
		const password = process.env.DATAFORSEO_PASSWORD;
		if (!username || !password)
			throw new DataForSeoScraperError("DataForSEO LLM Scraper credentials are not configured");
		const webSearch = options?.webSearch ?? false;
		try {
			// One billable request; no automatic retry of a potentially completed call.
			const response = await fetch(ENDPOINT, {
				method: "POST",
				headers: {
					Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([
					{
						keyword,
						location_name: locale.countryName ?? "United States",
						language_code: locale.languageCode ?? "en",
						force_web_search: webSearch,
					},
				]),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!response.ok) throw new DataForSeoScraperError(`DataForSEO LLM Scraper request failed (${response.status})`);
			return normalizeDataForSeoScraperResponse(await response.json(), prompt, webSearch);
		} catch (error) {
			if (error instanceof DataForSeoScraperError) throw error;
			// Fetch/JSON errors may contain upstream bodies or credential-bearing URLs.
			throw new DataForSeoScraperError("DataForSEO LLM Scraper acquisition failed");
		}
	},
};
