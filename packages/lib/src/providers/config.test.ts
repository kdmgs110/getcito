import { describe, expect, it } from "vitest";
import { parseScrapeTargets, validateScrapeTargets } from "./config";
import { getAllProviders, getProvider } from "./index";
import { oxylabs } from "./registry/oxylabs";
import { dataforseo } from "./registry/dataforseo";
import { olostep } from "./registry/olostep";
import type { ModelConfig } from "./types";

describe("parseScrapeTargets", () => {
	describe("basic parsing", () => {
		it("parses model:provider", () => {
			const result = parseScrapeTargets("chatgpt:olostep");
			expect(result).toEqual([{ model: "chatgpt", provider: "dataforseo-scraper", version: undefined, webSearch: true }]);
		});

		it("parses model:provider:online", () => {
			const result = parseScrapeTargets("chatgpt:olostep:online");
			expect(result).toEqual([{ model: "chatgpt", provider: "dataforseo-scraper", version: undefined, webSearch: true }]);
		});

		it("parses model:provider:version", () => {
			const result = parseScrapeTargets("chatgpt:openai-api:gpt-5.5");
			expect(result).toEqual([{ model: "chatgpt", provider: "openai-api", version: "gpt-5.5", webSearch: false }]);
		});

		it("parses model:provider:version:online", () => {
			const result = parseScrapeTargets("chatgpt:openai-api:gpt-5.5:online");
			expect(result).toEqual([{ model: "chatgpt", provider: "openai-api", version: "gpt-5.5", webSearch: true }]);
		});
	});

	it("parses multiple entries with mixed providers", () => {
		const result = parseScrapeTargets(
			"chatgpt:olostep:online,claude:openrouter:anthropic/claude-sonnet-4,google-ai-mode:dataforseo:online",
		);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ model: "chatgpt", provider: "dataforseo-scraper", version: undefined, webSearch: true });
		expect(result[1]).toEqual({
			model: "claude",
			provider: "openrouter",
			version: "anthropic/claude-sonnet-4",
			webSearch: false,
		});
		expect(result[2]).toEqual({ model: "google-ai-mode", provider: "dataforseo", version: undefined, webSearch: true });
	});

	it("handles OpenRouter version slugs with colons", () => {
		const result = parseScrapeTargets("chatgpt:openrouter:openai/gpt-5.5:free:online");
		expect(result).toEqual([
			{ model: "chatgpt", provider: "openrouter", version: "openai/gpt-5.5:free", webSearch: true },
		]);
	});

	describe("whitespace handling", () => {
		it("trims whitespace around entries", () => {
			const result = parseScrapeTargets(" chatgpt:olostep:online , google-ai-mode:olostep:online ");
			expect(result).toHaveLength(2);
			expect(result[0].model).toBe("chatgpt");
			expect(result[1].model).toBe("google-ai-mode");
		});
	});

	describe("error cases", () => {
		it("throws on empty string entries (trailing comma)", () => {
			expect(() => parseScrapeTargets("chatgpt:olostep,")).toThrow("empty entry");
		});

		it("throws on single-segment entries", () => {
			expect(() => parseScrapeTargets("chatgpt")).toThrow("need at least model:provider");
		});
	});

	describe("missing SCRAPE_TARGETS", () => {
		it("throws when SCRAPE_TARGETS is undefined", () => {
			expect(() => parseScrapeTargets(undefined)).toThrow("SCRAPE_TARGETS environment variable is required");
		});

		it("throws when SCRAPE_TARGETS is empty string", () => {
			expect(() => parseScrapeTargets("")).toThrow("SCRAPE_TARGETS environment variable is required");
		});
	});
});

describe("validateScrapeTargets", () => {
	const configuredProvider = { isConfigured: () => true };
	const unconfiguredProvider = { isConfigured: () => false };

	function makeGetProvider(providers: Record<string, { isConfigured(): boolean }>) {
		return (id: string) => providers[id];
	}

	it("passes when all providers are configured", () => {
		const configs = [
			{ model: "chatgpt", provider: "olostep", webSearch: true },
			{ model: "google-ai-mode", provider: "olostep", webSearch: true },
		];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ olostep: configuredProvider }))).not.toThrow();
	});

	it("throws on unknown provider", () => {
		const configs = [{ model: "chatgpt", provider: "nonexistent", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({}))).toThrow('unknown provider "nonexistent"');
	});

	it("throws when provider is not configured", () => {
		const configs = [{ model: "chatgpt", provider: "olostep", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ olostep: unconfiguredProvider }))).toThrow(
			"requires API key",
		);
	});

	it("throws when openai-api provider has no version", () => {
		const configs = [{ model: "chatgpt", provider: "openai-api", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "openai-api": configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("throws when anthropic-api provider has no version", () => {
		const configs = [{ model: "claude", provider: "anthropic-api", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "anthropic-api": configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("throws when openrouter provider has no version", () => {
		const configs = [{ model: "chatgpt", provider: "openrouter", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ openrouter: configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("throws when mistral-api provider has no version", () => {
		const configs = [{ model: "mistral", provider: "mistral-api", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "mistral-api": configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("passes when mistral-api provider has a version", () => {
		const configs = [{ model: "mistral", provider: "mistral-api", version: "mistral-medium-latest", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "mistral-api": configuredProvider }))).not.toThrow();
	});

	it("passes when openai-api provider has a version", () => {
		const configs = [{ model: "chatgpt", provider: "openai-api", version: "gpt-5.5", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "openai-api": configuredProvider }))).not.toThrow();
	});

	it("passes when anthropic-api provider has a version", () => {
		const configs = [{ model: "claude", provider: "anthropic-api", version: "claude-sonnet-4", webSearch: true }];
		expect(() =>
			validateScrapeTargets(configs, makeGetProvider({ "anthropic-api": configuredProvider })),
		).not.toThrow();
	});

	it("passes when openrouter provider has a version", () => {
		const configs = [{ model: "chatgpt", provider: "openrouter", version: "openai/gpt-5.5", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ openrouter: configuredProvider }))).not.toThrow();
	});

	it("does not require version for scraping providers", () => {
		const configs = [
			{ model: "chatgpt", provider: "olostep", webSearch: true },
			{ model: "chatgpt", provider: "dataforseo-scraper", webSearch: true },
			{ model: "chatgpt", provider: "oxylabs", webSearch: true },
			{ model: "google-ai-mode", provider: "dataforseo", webSearch: true },
		];
		expect(() =>
			validateScrapeTargets(
				configs,
				makeGetProvider({
					olostep: configuredProvider,
					"dataforseo-scraper": configuredProvider,
					oxylabs: configuredProvider,
					dataforseo: configuredProvider,
				}),
			),
		).not.toThrow();
	});
});

describe("provider validateTarget", () => {
	function config(model: string, provider: string, webSearch: boolean, version?: string): ModelConfig {
		return { model, provider, version, webSearch };
	}

	describe("olostep", () => {
		it("accepts valid online targets", () => {
			for (const model of [
				"chatgpt",
				"google-ai-mode",
				"google-ai-overview",
				"gemini",
				"copilot",
				"perplexity",
				"grok",
			]) {
				expect(olostep.validateTarget!(config(model, "olostep", true))).toBeNull();
			}
		});

		// The `:online` requirement was dropped in 6ff27ea: these engines always
		// search, so the flag says nothing about the target's validity and
		// rejecting it only broke otherwise-working configurations.
		it("accepts targets without :online", () => {
			expect(olostep.validateTarget!(config("chatgpt", "olostep", false))).toBeNull();
		});

		it("rejects unknown models", () => {
			expect(olostep.validateTarget!(config("unknown", "olostep", true))).toMatch(/does not support/);
		});
	});

	describe("dataforseo", () => {
		it("accepts google-ai-mode:online", () => {
			expect(dataforseo.validateTarget!(config("google-ai-mode", "dataforseo", true))).toBeNull();
		});

		it("rejects without :online", () => {
			expect(dataforseo.validateTarget!(config("google-ai-mode", "dataforseo", false))).toMatch(/requires :online/);
		});

		it("rejects unsupported models", () => {
			expect(dataforseo.validateTarget!(config("copilot", "dataforseo", true))).toMatch(/only supports/);
		});

		it("accepts chatgpt/perplexity/gemini with :online", () => {
			for (const model of ["chatgpt", "perplexity", "gemini"]) {
				expect(dataforseo.validateTarget!(config(model, "dataforseo", true))).toBeNull();
			}
		});

		it("accepts an explicit model_name via the version slug", () => {
			expect(dataforseo.validateTarget!(config("chatgpt", "dataforseo", true, "gpt-4.1"))).toBeNull();
		});

		it("rejects chatgpt/perplexity/gemini without :online", () => {
			expect(dataforseo.validateTarget!(config("chatgpt", "dataforseo", false))).toMatch(/requires :online/);
		});
	});

	describe("oxylabs", () => {
		it("accepts chatgpt with and without :online", () => {
			expect(oxylabs.validateTarget!(config("chatgpt", "oxylabs", true))).toBeNull();
			expect(oxylabs.validateTarget!(config("chatgpt", "oxylabs", false))).toBeNull();
		});

		it("accepts perplexity and google-ai-mode with :online", () => {
			expect(oxylabs.validateTarget!(config("perplexity", "oxylabs", true))).toBeNull();
			expect(oxylabs.validateTarget!(config("google-ai-mode", "oxylabs", true))).toBeNull();
		});

		it("rejects perplexity / google-ai-mode without :online", () => {
			expect(oxylabs.validateTarget!(config("perplexity", "oxylabs", false))).toMatch(/requires :online/);
			expect(oxylabs.validateTarget!(config("google-ai-mode", "oxylabs", false))).toMatch(/requires :online/);
		});

		it("rejects unsupported models (e.g. copilot, gemini, grok)", () => {
			expect(oxylabs.validateTarget!(config("copilot", "oxylabs", true))).toMatch(/does not support/);
			expect(oxylabs.validateTarget!(config("gemini", "oxylabs", true))).toMatch(/does not support/);
			expect(oxylabs.validateTarget!(config("grok", "oxylabs", true))).toMatch(/does not support/);
		});
	});
});


describe("retired acquisition registry", () => {
	it("does not offer Bright Data and explains how to migrate an old provider", () => {
		expect(getAllProviders().some((provider) => provider.id === "brightdata")).toBe(false);
		expect(() => getProvider("brightdata")).toThrow("Bright Data acquisition has been retired");
		expect(() => getProvider("brightdata")).toThrow("chatgpt:dataforseo-scraper:online");
	});
});
