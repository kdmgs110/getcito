import { afterEach, describe, expect, it, vi } from "vitest";
import { azureFoundryApi, liveSearchParameters } from "./azure-foundry-api";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("isConfigured", () => {
	it("requires both the API key and base URL", () => {
		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "key");
		vi.stubEnv("AZURE_FOUNDRY_BASE_URL", "");
		expect(azureFoundryApi.isConfigured()).toBe(false);

		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "");
		vi.stubEnv("AZURE_FOUNDRY_BASE_URL", "https://example.services.ai.azure.com/models");
		expect(azureFoundryApi.isConfigured()).toBe(false);

		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "key");
		expect(azureFoundryApi.isConfigured()).toBe(true);
	});
});

describe("liveSearchParameters", () => {
	it("scopes the web source to the brand's target market", () => {
		expect(liveSearchParameters({ webSearch: true, targetMarket: "India" })).toEqual({
			mode: "auto",
			return_citations: true,
			sources: [{ type: "web", country: "IN" }, { type: "x" }],
		});
	});

	it("keeps xAI's default sources when the brand has no target market", () => {
		expect(liveSearchParameters({ webSearch: true })).toEqual({
			mode: "auto",
			return_citations: true,
		});
	});

	it("rejects an invalid explicit market rather than silently guessing", () => {
		expect(() => liveSearchParameters({ targetMarket: "Atlantis" })).toThrow("BRAND_MARKET_INVALID");
	});
});
