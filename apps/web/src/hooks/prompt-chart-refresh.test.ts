import { environmentManager, focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ batch: vi.fn(), prompt: vi.fn() }));
vi.mock("@/server/visibility", () => ({ getBatchChartDataFn: mocks.batch }));
vi.mock("@/server/prompts", () => ({ getPromptChartDataFn: mocks.prompt }));

import { batchChartQueryOptions } from "./use-batch-chart-data";
import { promptChartQueryOptions } from "./use-prompt-chart-data";

let client: QueryClient;
let unsubscribe: (() => void) | undefined;
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	environmentManager.setIsServer(() => false);
	focusManager.setFocused(true);
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	client.mount();
});
afterEach(() => {
	unsubscribe?.();
	unsubscribe = undefined;
	client.unmount();
	client.clear();
	focusManager.setFocused(undefined);
	environmentManager.setIsServer(() => true);
	vi.useRealTimers();
});

describe("charts update as asynchronous evaluations finish", () => {
	it("refreshes an initially empty visibility chart without remounting the page", async () => {
		const empty = {
			chartData: [],
			brand: { id: "rails", name: "Rails案件" },
			competitors: [],
			dateRange: { fromDate: "2026-10-01", toDate: "2026-10-31" },
		};
		mocks.batch.mockResolvedValueOnce(empty).mockResolvedValue({
			...empty,
			chartData: [
				{ prompt_id: "question", date: "2026-10-31", total_runs: 1, brand_mentioned_count: 0, competitor_counts: {} },
			],
		});
		const observer = new QueryObserver(client, batchChartQueryOptions("rails", { model: "google-ai-mode" }));
		unsubscribe = observer.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(1);
		expect(observer.getCurrentResult().data?.chartData).toEqual([]);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(observer.getCurrentResult().data?.chartData[0].total_runs).toBe(1);
		expect(mocks.batch).toHaveBeenCalledTimes(2);
		expect(mocks.batch).toHaveBeenLastCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ brandId: "rails", model: "google-ai-mode" }) }),
		);
	});

	it("refreshes a prompt detail from zero runs to its first saved run", async () => {
		mocks.prompt.mockResolvedValueOnce({ totalRuns: 0 }).mockResolvedValue({ totalRuns: 1, hasVisibilityData: false });
		const observer = new QueryObserver(client, promptChartQueryOptions("rails", "question"));
		unsubscribe = observer.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(1);
		expect(observer.getCurrentResult().data?.totalRuns).toBe(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(observer.getCurrentResult().data?.totalRuns).toBe(1);
		// A completed evaluation with no brand mentions still counts as a run.
		expect(observer.getCurrentResult().data?.hasVisibilityData).toBe(false);
	});

	it("refreshes stale charts when the user returns to the tab", async () => {
		mocks.batch.mockResolvedValue({ chartData: [] });
		const observer = new QueryObserver(client, batchChartQueryOptions("rails"));
		unsubscribe = observer.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(1);
		focusManager.setFocused(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.batch).toHaveBeenCalledTimes(1);
		focusManager.setFocused(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.batch).toHaveBeenCalledTimes(2);
	});

	it("keeps a disabled prompt query inactive instead of polling it", async () => {
		const observer = new QueryObserver(client, promptChartQueryOptions("rails", "question", undefined, false));
		unsubscribe = observer.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(120_000);
		expect(mocks.prompt).not.toHaveBeenCalled();
	});
});
