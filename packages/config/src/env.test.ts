import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("DataForSEO scraper credential requirements", () => {
	it("requires both shared account keys when the scraper is the only selected provider", async () => {
		vi.stubEnv("SCRAPE_TARGETS", "chatgpt:dataforseo-scraper:online");
		vi.resetModules();
		const { getEnvRequirements } = await import("./env");
		const requirement = getEnvRequirements("local").find((item) => item.id === "PROVIDER_DATAFORSEO_SCRAPER");
		expect(requirement).toBeDefined();
		expect(requirement?.label).toBe("DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD");
		expect(requirement?.isSatisfied({})).toBe(false);
		expect(requirement?.isSatisfied({ DATAFORSEO_LOGIN: "account" })).toBe(false);
		expect(requirement?.isSatisfied({ DATAFORSEO_PASSWORD: "private-value" })).toBe(false);
		expect(requirement?.isSatisfied({ DATAFORSEO_LOGIN: "account", DATAFORSEO_PASSWORD: "private-value" })).toBe(true);
	});
});
