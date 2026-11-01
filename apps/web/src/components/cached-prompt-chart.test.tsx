import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ totalRuns: 3 }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ search, children }: { search: (previous: object) => object; children: React.ReactNode }) => (
		<a href={`?${new URLSearchParams(search({ lookback: "1w" }) as Record<string, string>)}`}>{children}</a>
	),
}));
vi.mock("@/contexts/chart-data-context", () => ({
	useOptionalChartDataContext: () => ({
		isLoading: false,
		brand: { id: "brand", name: "Rails案件.com" },
		competitors: [],
		getChartDataForPrompt: () => ({ totalRuns: mocks.totalRuns, hasVisibilityData: false, chartData: [] }),
	}),
}));
vi.mock("@/hooks/use-chart-export", () => ({
	useChartExport: () => ({ isExporting: false, handleExport: vi.fn(), portal: null }),
}));
vi.mock("./chart-actions-footer", () => ({ ChartActionsFooter: () => null }));
vi.mock("./base-chart", () => ({ BaseChart: () => null }));
import { CachedPromptChart } from "./cached-prompt-chart";

beforeEach(() => {
	mocks.totalRuns = 3;
});
describe("answers without brand mentions", () => {
	it("shows collected answer count and links straight to the selected target's answer history", () => {
		const html = renderToStaticMarkup(
			<CachedPromptChart
				promptId="prompt"
				promptName="Rails案件を探したい"
				brandId="brand"
				lookback="1w"
				selectedModel="google-ai-mode:dataforseo:online"
				hasEverBeenEvaluated
			/>,
		);
		expect(html).toContain("回答を3件取得済み");
		expect(html).toContain("回答を表示");
		expect(html).toContain("tab=responses");
		expect(html).toContain("model=google-ai-mode%3Adataforseo%3Aonline");
		expect(html).toContain("lookback=1w");
		expect(html).not.toContain("view=compare");
	});
	it("opens measurement comparison for Overview with no answer rows, including not-shown attempts", () => {
		mocks.totalRuns = 0;
		const html = renderToStaticMarkup(
			<CachedPromptChart
				promptId="prompt"
				promptName="Rails案件"
				brandId="brand"
				lookback="1w"
				selectedModel="google-ai-overview:brightdata:online"
				hasEverBeenEvaluated
			/>,
		);
		expect(html).toContain("計測結果を表示");
		expect(html).toContain("view=compare");
		expect(html).toContain("targetKey=google-ai-overview%3Abrightdata%3Aonline");
		expect(html).not.toContain("回答を0件取得済み");
	});
	it("does not label an empty selected period as collected answers", () => {
		mocks.totalRuns = 0;
		const html = renderToStaticMarkup(
			<CachedPromptChart promptId="prompt" promptName="Rails案件" brandId="brand" lookback="1w" hasEverBeenEvaluated />,
		);
		expect(html).not.toContain("回答を表示");
		expect(html).not.toContain("tab=responses");
	});
});
