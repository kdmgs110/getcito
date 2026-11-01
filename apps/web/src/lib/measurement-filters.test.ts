import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { describe, expect, it } from "vitest";
import {
	historicalMeasurementConfig,
	measurementFilterOptions,
	orderedMeasurementConfigs,
	resolveMeasurementFilter,
} from "./measurement-filters";

const configs = parseScrapeTargets(
	"chatgpt:openai-api:gpt-5:online,chatgpt:brightdata:online,google-ai-overview:brightdata:online",
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
		expect(resolveMeasurementFilter(undefined, ordered)).toBe("chatgpt:brightdata:online");
		expect(resolveMeasurementFilter("all", ordered)).toBe("chatgpt:brightdata:online");
		expect(resolveMeasurementFilter("chatgpt", ordered)).toBe("chatgpt:brightdata:online");
	});
	it("preserves an explicit historical provider/version and rejects noncanonical URLs", () => {
		expect(resolveMeasurementFilter("chatgpt:openrouter:old:online", configs)).toBe("chatgpt:openrouter:old:online");
		expect(historicalMeasurementConfig("chatgpt:openai-api:x,chatgpt:brightdata:online")).toEqual([]);
		expect(historicalMeasurementConfig(":brightdata:online")).toEqual([]);
		expect(resolveMeasurementFilter(" chatgpt:brightdata:online", configs)).toBe("chatgpt:openai-api:gpt-5:online");
	});
});
