/**
 * The single module that parses and formats the SCRAPE_TARGETS env var.
 *
 * Format: model:provider[:version][:online]
 * - model: AI model to track (chatgpt, google-ai-mode, copilot, etc.)
 * - provider: How to reach it (dataforseo-scraper, olostep, direct, openrouter, dataforseo)
 * - version: Specific version slug, required for direct/openrouter (may contain colons for OpenRouter variants)
 * - :online: Append to enable web search. Omit = no web search.
 */

export interface ModelConfig {
	model: string;
	provider: string;
	version?: string;
	webSearch: boolean;
}

export const CHATGPT_WEB_TARGET = "chatgpt:dataforseo-scraper:online";
const CHATGPT_WEB_PROVIDERS = new Set(["brightdata", "olostep", "cloro", "oxylabs", "dataforseo-scraper"]);

/** Normalize active settings only. Historical run identities must stay unchanged. */
export function normalizeActiveTarget(config: ModelConfig): ModelConfig {
	if (config.model === "chatgpt" && CHATGPT_WEB_PROVIDERS.has(config.provider)) {
		return {
			model: "chatgpt",
			provider: "dataforseo-scraper",
			version: config.provider === "dataforseo-scraper" ? config.version : undefined,
			webSearch: true,
		};
	}
	return config;
}

/** Supports old saved settings and links without relabelling historical results. */
export function normalizeActiveTargetKey(value: string): string {
	if (value.includes(",") || value.trim() !== value) return value;
	const parts = value.split(":");
	if (
		parts[0] === "chatgpt" &&
		CHATGPT_WEB_PROVIDERS.has(parts[1]) &&
		(parts[1] !== "dataforseo-scraper" || parts.length === 2 || value === CHATGPT_WEB_TARGET)
	)
		return CHATGPT_WEB_TARGET;
	return value;
}

export function isRetiredAcquisition(model: string, provider: string | null | undefined): boolean {
	return (
		provider === "brightdata" ||
		(model === "chatgpt" && !!provider && CHATGPT_WEB_PROVIDERS.has(provider) && provider !== "dataforseo-scraper")
	);
}

/**
 * Parse the SCRAPE_TARGETS env var into structured ModelConfig objects.
 *
 * Parsing: split on ":". First = model, second = provider. If last segment is "online",
 * pop it (websearch = true). Remaining middle segments rejoined with ":" = version slug.
 * This naturally handles OpenRouter variant suffixes like ":free".
 */
export function parseScrapeTargets(envValue?: string, options: { normalizeWebTargets?: boolean } = {}): ModelConfig[] {
	if (!envValue || !envValue.trim()) {
		throw new Error(
			"SCRAPE_TARGETS environment variable is required. " +
				"Set it to configure which AI models to track. Example:\n" +
				"  SCRAPE_TARGETS=chatgpt:dataforseo-scraper:online,google-ai-mode:olostep:online,copilot:olostep:online\n" +
				"See https://docs.Getcito,com for details.",
		);
	}
	const configs = envValue.split(",").map((raw) => {
		const trimmed = raw.trim();
		if (!trimmed) throw new Error("Invalid SCRAPE_TARGETS: empty entry (check for trailing commas)");
		const parts = trimmed.split(":");
		if (parts.length < 2) throw new Error(`Invalid SCRAPE_TARGETS entry: "${trimmed}" (need at least model:provider)`);
		const model = parts[0];
		const provider = parts[1];
		const webSearch = parts[parts.length - 1] === "online";
		const versionParts = parts.slice(2, webSearch ? -1 : undefined);
		const version = versionParts.length > 0 ? versionParts.join(":") : undefined;
		if (provider === "brightdata" && model !== "chatgpt") {
			throw new Error(`Bright Data acquisition has been removed: configure a supported provider for "${model}".`);
		}
		const config = { model, provider, version, webSearch };
		// Research overrides name a provider explicitly; measurement settings use
		// the canonical ChatGPT Web acquisition instead.
		return options.normalizeWebTargets === false ? config : normalizeActiveTarget(config);
	});
	return [...new Map(configs.map((config) => [formatScrapeTarget(config), config])).values()];
}

/**
 * Inverse of parseScrapeTargets for a single entry: build the
 * model:provider[:version][:online] string from a ModelConfig.
 */
export function formatScrapeTarget(config: ModelConfig): string {
	const parts = [config.model, config.provider];
	if (config.version) parts.push(config.version);
	if (config.webSearch) parts.push("online");
	return parts.join(":");
}
