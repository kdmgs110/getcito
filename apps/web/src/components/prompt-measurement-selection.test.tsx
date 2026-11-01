import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PromptMeasurementsResponse } from "@/lib/prompt-measurements";
const mocks = vi.hoisted(() => ({ data: undefined as PromptMeasurementsResponse | undefined }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.data, isLoading: false, isError: false }) }));
vi.mock("@/server/prompt-measurements", () => ({
	getPromptMeasurementDetailFn: vi.fn(),
	getPromptMeasurementsFn: vi.fn(),
}));
import { PromptMeasurementComparison } from "./prompt-measurements";

describe("measurement comparison deep-link target", () => {
	it("prefers the requested provider over the first configured source without mixing its answer", () => {
		mocks.data = {
			targets: ["brightdata", "dataforseo-scraper"].map((provider) => ({
				key: `chatgpt:${provider}:online`,
				model: "chatgpt",
				provider,
				requestedVersion: null,
				webSearch: true,
				label: "ChatGPT Web",
				surface: "chatgpt_web",
				configured: true,
			})),
			records: ["brightdata", "dataforseo-scraper"].map((provider) => ({
				id: provider,
				attemptId: provider,
				runId: null,
				targetKey: `chatgpt:${provider}:online`,
				model: "chatgpt",
				provider,
				version: null,
				status: "succeeded",
				createdAt: "2026-11-01T00:00:00Z",
				completedAt: "2026-11-01T00:00:00Z",
				requestContext: null,
				evidence: {
					version: 1,
					answerText: `Answer from ${provider}`,
					answerStatus: "shown",
					queryStatus: "not_exposed",
					queryEvidence: [],
				},
				queries: [],
				citations: [],
			})),
		};
		const html = renderToStaticMarkup(
			<PromptMeasurementComparison
				scope={{ brandId: "brand", promptId: "prompt", lookback: "1w", language: "all" }}
				preferredTargetKey="chatgpt:dataforseo-scraper:online"
				onQueries={() => {}}
			/>,
		);
		expect(html).toContain("Answer from dataforseo-scraper");
		expect(html).not.toContain("Answer from brightdata");
	});
});
