import { describe, expect, it } from "vitest";
import { selectTargetsForBrand } from "./runner";
import type { ModelConfig } from "./types";

const configs: ModelConfig[] = [
	{ model: "chatgpt", provider: "brightdata", version: undefined, webSearch: true },
	{ model: "claude", provider: "anthropic-api", version: "claude-sonnet-4", webSearch: false },
	{ model: "google-ai-mode", provider: "dataforseo", version: undefined, webSearch: true },
];

describe("selectTargetsForBrand", () => {
	it("selects a Web target without also enabling the API with the same model", () => {
		const alternatives = [...configs, { model: "chatgpt", provider: "openai-api", version: "gpt-4o", webSearch: true }];
		expect(selectTargetsForBrand(alternatives, null, ["chatgpt:brightdata:online"])).toEqual([configs[0]]);
	});
	it("keeps an explicit empty target selection disabled even with legacy enabled models", () => {
		expect(selectTargetsForBrand(configs, ["chatgpt"], [])).toEqual([]);
	});
	it("rejects unknown exact targets", () => {
		expect(() => selectTargetsForBrand(configs, null, ["chatgpt:openai-api:gpt-4o:online"])).toThrow(/enabledTargets/);
	});
	it("retains legacy model behavior for a null target override", () => {
		expect(selectTargetsForBrand(configs, ["chatgpt"], null)).toEqual([configs[0]]);
	});
	it("returns all configs when enabledModels is null", () => {
		expect(selectTargetsForBrand(configs, null)).toEqual(configs);
	});

	it("returns all configs when enabledModels is undefined", () => {
		expect(selectTargetsForBrand(configs, undefined)).toEqual(configs);
	});

	it("returns empty array when enabledModels is an empty array (explicit opt-out)", () => {
		expect(selectTargetsForBrand(configs, [])).toEqual([]);
	});

	it("filters to the intersection when enabledModels is set", () => {
		const result = selectTargetsForBrand(configs, ["chatgpt", "google-ai-mode"]);
		expect(result).toHaveLength(2);
		expect(result.map((c) => c.model)).toEqual(["chatgpt", "google-ai-mode"]);
	});

	it("throws when enabledModels contains a model not in configs", () => {
		expect(() => selectTargetsForBrand(configs, ["perplexity"])).toThrow(
			/brand\.enabledModels references models not in SCRAPE_TARGETS: perplexity/,
		);
	});

	it("throws when enabledModels mixes known and unknown models", () => {
		expect(() => selectTargetsForBrand(configs, ["chatgpt", "does-not-exist"])).toThrow(/does-not-exist/);
	});

	it("keeps duplicates in configs when the model is allowed (multi-sample case)", () => {
		const duplicated: ModelConfig[] = [
			{ model: "chatgpt", provider: "brightdata", version: undefined, webSearch: true },
			{ model: "chatgpt", provider: "olostep", version: undefined, webSearch: true },
		];
		expect(selectTargetsForBrand(duplicated, ["chatgpt"])).toEqual(duplicated);
	});
});
