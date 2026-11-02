import { describe, expect, it } from "vitest";
import { formatScrapeTarget, type ModelConfig, parseScrapeTargets } from "./scrape-targets";

describe("formatScrapeTarget", () => {
	it("formats model:provider", () => {
		expect(formatScrapeTarget({ model: "chatgpt", provider: "brightdata", webSearch: false })).toBe(
			"chatgpt:brightdata",
		);
	});

	it("formats model:provider:online", () => {
		expect(formatScrapeTarget({ model: "chatgpt", provider: "olostep", webSearch: true })).toBe(
			"chatgpt:olostep:online",
		);
	});

	it("formats model:provider:version", () => {
		expect(formatScrapeTarget({ model: "chatgpt", provider: "openai-api", version: "gpt-5.5", webSearch: false })).toBe(
			"chatgpt:openai-api:gpt-5.5",
		);
	});

	it("formats model:provider:version:online", () => {
		expect(
			formatScrapeTarget({
				model: "claude",
				provider: "openrouter",
				version: "anthropic/claude-sonnet-4.6",
				webSearch: true,
			}),
		).toBe("claude:openrouter:anthropic/claude-sonnet-4.6:online");
	});
});

describe("round-trip", () => {
	it("parse(format(x)) returns x", () => {
		const configs: ModelConfig[] = [
			{ model: "chatgpt", provider: "dataforseo-scraper", version: undefined, webSearch: true },

			{ model: "claude", provider: "anthropic-api", version: "claude-sonnet-4-6", webSearch: true },
			{ model: "chatgpt", provider: "openai-api", version: "gpt-5.5", webSearch: false },
			{ model: "chatgpt", provider: "openrouter", version: "openai/gpt-5.5:free", webSearch: true },
			{ model: "google-ai-mode", provider: "dataforseo", version: undefined, webSearch: true },
		];
		for (const config of configs) {
			expect(parseScrapeTargets(formatScrapeTarget(config))).toEqual([config]);
		}
	});

	it("format(parse(s)) returns s", () => {
		const value =
			"chatgpt:dataforseo-scraper:online,claude:openrouter:anthropic/claude-sonnet-4.6,mistral:mistral-api:mistral-medium-latest:online";
		expect(parseScrapeTargets(value).map(formatScrapeTarget).join(",")).toBe(value);
	});
});

it("preserves an explicit research provider when web-target normalization is disabled", () => {
	expect(parseScrapeTargets("chatgpt:olostep:online", { normalizeWebTargets: false })).toEqual([
		{ model: "chatgpt", provider: "olostep", version: undefined, webSearch: true },
	]);
});

describe("ChatGPT Web cutover", () => {
	it("collapses former web providers and offline settings into one online target", () => {
		expect(
			parseScrapeTargets(
				"chatgpt:brightdata,chatgpt:olostep:online,chatgpt:oxylabs:online,chatgpt:dataforseo-scraper:online",
			).map(formatScrapeTarget),
		).toEqual(["chatgpt:dataforseo-scraper:online"]);
	});
	it("keeps ChatGPT API targets separate", () => {
		expect(parseScrapeTargets("chatgpt:brightdata:online,chatgpt:openai-api:gpt-5:online")).toHaveLength(2);
	});
	it("fails with an actionable message for removed acquisition on other models", () => {
		expect(() => parseScrapeTargets("google-ai-overview:brightdata:online")).toThrow(/supported provider/);
	});
});
