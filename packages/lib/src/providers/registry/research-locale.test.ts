import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const sdk = vi.hoisted(() => ({
	generateText: vi.fn(),
	webSearch: vi.fn((options) => options),
	anthropicSearch: vi.fn((options) => options),
}));
vi.mock("ai", () => ({ generateText: sdk.generateText, Output: { object: (options: unknown) => options } }));
vi.mock("@ai-sdk/openai", () => {
	const provider = { responses: (model: string) => model, tools: { webSearch: sdk.webSearch } };
	return { openai: provider, createOpenAI: () => provider };
});
vi.mock("@ai-sdk/anthropic", () => {
	const provider = Object.assign((model: string) => model, { tools: { webSearch_20250305: sdk.anthropicSearch } });
	return { anthropic: provider, createAnthropic: () => provider };
});

import { anthropicApi } from "./anthropic-api";
import { azureFoundryApi } from "./azure-foundry-api";
import { mistralApi } from "./mistral-api";
import { openaiApi } from "./openai-api";
import { openrouter } from "./openrouter";

const schema = z.object({ name: z.string() });
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("structured research locale", () => {
	it.each([
		openaiApi,
		anthropicApi,
	])("passes Japanese instruction and Japan search location to $id", async (provider) => {
		sdk.generateText.mockResolvedValue({ experimental_output: { name: "日本語" } });
		await provider.runStructuredResearch!({ prompt: "Rails案件", schema, targetLanguage: "ja-JP", targetMarket: "JP" });
		const request = sdk.generateText.mock.calls[0][0];
		expect(request.system).toContain("language: Japanese");
		expect(request.system).toContain("location is: Japan");
		expect(request.tools.web_search.userLocation).toMatchObject({ country: "JP" });
	});
	it.each([openrouter, mistralApi, azureFoundryApi])("includes locale in $id research messages", async (provider) => {
		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "test-key");
		vi.stubEnv("AZURE_FOUNDRY_BASE_URL", "https://example.services.ai.azure.com/models");
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ choices: [{ message: { content: '{"name":"日本語"}' } }] }));
		vi.stubGlobal("fetch", fetchMock);
		await provider.runStructuredResearch!({
			prompt: "Rails案件",
			schema,
			webSearch: false,
			targetLanguage: "ja",
			targetMarket: "Japan",
		});
		const request = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(request.messages[0]).toEqual({
			role: "system",
			content: "Please provide your response in language: Japanese. Assume the user's location is: Japan.",
		});
		expect(request.messages[1]).toEqual({ role: "user", content: "Rails案件" });
	});
	it("keeps an explicitly English research language independent from its Japanese market", async () => {
		sdk.generateText.mockResolvedValue({ experimental_output: { name: "English" } });
		await openaiApi.runStructuredResearch!({
			prompt: "Rails jobs",
			schema,
			webSearch: false,
			targetLanguage: "English",
			targetMarket: "Japan",
		});
		expect(sdk.generateText.mock.calls[0][0].system).toContain("language: English");
		expect(sdk.generateText.mock.calls[0][0].tools).toBeUndefined();
	});
});
