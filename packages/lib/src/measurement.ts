import { formatScrapeTarget, type ModelConfig } from "@workspace/config/scrape-targets";
import type { PageEvidence } from "./page-evidence";

/** Evidence reported by the acquisition provider, never reconstructed queries. */
export interface QueryEvidence {
	query: string;
	urls: Array<{ url: string; title?: string; role: "search_result" | "visited" | "citation" | "unknown" }>;
	/** Provider response field carrying the explicit query→URL relationship. */
	sourceField: string;
}

export interface MeasurementEvidence {
	version: 1;
	answerText: string;
	answerStatus: "shown" | "not_shown" | "unknown";
	queryStatus: "observed" | "not_exposed" | "not_used" | "unknown";
	queryEvidence: QueryEvidence[];
	submittedPrompt?: string;
	pageEvidence?: PageEvidence;
}

export type MeasurementSurface = "chatgpt_web" | "google_ai_overview" | "google_ai_mode" | "llm_api" | "unknown";

export function measurementSurface(model: string, provider: string | null | undefined): MeasurementSurface {
	if (!provider) return "unknown";
	if (model === "google-ai-overview" && ["brightdata", "olostep", "cloro"].includes(provider)) {
		return "google_ai_overview";
	}
	if (model === "google-ai-mode") return "google_ai_mode";
	if (model === "chatgpt" && ["brightdata", "olostep", "cloro", "oxylabs", "dataforseo-scraper"].includes(provider)) {
		return "chatgpt_web";
	}
	if (
		["openai-api", "anthropic-api", "azure-foundry-api", "mistral-api", "openrouter", "dataforseo"].includes(provider)
	) {
		return "llm_api";
	}
	return "unknown";
}

/** Includes the requested version (not the upstream returned model name). */
export function measurementTargetKey(config: ModelConfig): string {
	return formatScrapeTarget(config);
}

export function measurementTargetLabel(model: string, provider: string | null | undefined): string {
	const surface = measurementSurface(model, provider);
	if (surface === "chatgpt_web") return "ChatGPT Web";
	if (surface === "google_ai_overview") return "Google AI Overview";
	if (surface === "google_ai_mode") return "Google AI Mode";
	if (model === "chatgpt" && surface === "llm_api") return "ChatGPT API";
	return `${model}${surface === "llm_api" ? " API" : surface === "unknown" ? " (unknown)" : ""}`;
}

export function safeEvidenceUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const parsed = new URL(value);
		return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
	} catch {
		return null;
	}
}
