import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { describe, expect, it } from "vitest";
import {
	historicalMeasurementConfig,
	measurementFilterOptions,
	normalizeMeasurementSelection,
	orderedMeasurementConfigs,
	resolveMeasurementFilter,
} from "./measurement-filters";

const configs = parseScrapeTargets(
	"chatgpt:openai-api:gpt-5:online,chatgpt:dataforseo-scraper:online,google-ai-overview:olostep:online",
);
describe("exact measurement filter options", () => {
	it("keeps Web and API distinct even for the same model", () => {
		const options = measurementFilterOptions(configs);
		expect(options).toHaveLength(3);
		expect(options[0].label).toContain("ChatGPT API");
		expect(options[1].label).toContain("ChatGPT Web");
		expect(new Set(options.map((option) => option.value)).size).toBe(3);
	});
	it("defaults to the brand's effective target while allowing other deployment history", () => {
		const ordered = orderedMeasurementConfigs([configs[1]], configs);
		expect(ordered).toHaveLength(3);
		expect(resolveMeasurementFilter(undefined, ordered)).toBe("chatgpt:dataforseo-scraper:online");
		expect(resolveMeasurementFilter("all", ordered)).toBe("chatgpt:dataforseo-scraper:online");
		expect(resolveMeasurementFilter("chatgpt", ordered)).toBe("chatgpt:dataforseo-scraper:online");
	});
	it("preserves an explicit historical provider/version and rejects noncanonical URLs", () => {
		expect(resolveMeasurementFilter("chatgpt:openrouter:old:online", configs)).toBe("chatgpt:openrouter:old:online");
		expect(historicalMeasurementConfig("chatgpt:openai-api:x,chatgpt:dataforseo-scraper:online")).toEqual([]);
		expect(historicalMeasurementConfig(":dataforseo-scraper:online")).toEqual([]);
		expect(resolveMeasurementFilter(" chatgpt:dataforseo-scraper:online", configs)).toBe(
			"chatgpt:openai-api:gpt-5:online",
		);
	});
});

it("hides retired sources and migrates old links to the one ChatGPT Web target", () => {
	const old = { model: "chatgpt", provider: "brightdata", webSearch: true };
	expect(measurementFilterOptions([old, ...configs]).some((option) => option.label.includes("brightdata"))).toBe(false);
	expect(resolveMeasurementFilter("chatgpt:brightdata:online", configs)).toBe("chatgpt:dataforseo-scraper:online");
	expect(normalizeMeasurementSelection({ targetKey: "chatgpt:brightdata:online", attemptId: "old" })).toEqual({
		targetKey: "chatgpt:dataforseo-scraper:online",
		migrated: true,
	});
	expect(
		measurementFilterOptions(configs).find((option) => option.value === "chatgpt:dataforseo-scraper:online")?.label,
	).toBe("ChatGPT Web");
});

it("migrates old model URLs before reusing a historical answer ID", () => {
	expect(normalizeMeasurementSelection({ model: "chatgpt:brightdata:online", runId: "old" })).toEqual({
		targetKey: "chatgpt:dataforseo-scraper:online",
		migrated: true,
	});
});

it("keeps provider labels distinct on other measurement surfaces", () => {
	const options = measurementFilterOptions([
		{ model: "google-ai-overview", provider: "cloro", webSearch: true },
		{ model: "google-ai-overview", provider: "olostep", webSearch: true },
	]);
	expect(options[0].label).toContain("cloro");
	expect(options[1].label).toContain("olostep");
});
