import { environmentManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getReport: vi.fn() }));
vi.mock("@/server/opportunities", () => ({ getOpportunitiesFn: mocks.getReport }));
import { opportunitiesKeys, opportunitiesQueryOptions } from "./opportunities-query";

let client: QueryClient;
let unsubscribe: (() => void) | undefined;
const report = (summary: string) => ({
	report: { summary: [summary], opportunities: [], risks: [] },
	reason: null,
	generatedFor: null,
});

beforeEach(() => {
	vi.useFakeTimers();
	environmentManager.setIsServer(() => false);
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	mocks.getReport.mockReset().mockResolvedValue(report("日本語の提案"));
});
afterEach(() => {
	unsubscribe?.();
	unsubscribe = undefined;
	client.clear();
	environmentManager.setIsServer(() => true);
	vi.useRealTimers();
});

describe("opportunities follow saved brand language", () => {
	it("waits for the saved brand locale before issuing the initial request", async () => {
		const observer = new QueryObserver(client, opportunitiesQueryOptions("brand", undefined));
		unsubscribe = observer.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.getReport).not.toHaveBeenCalled();
		observer.setOptions(
			opportunitiesQueryOptions("brand", { targetLanguage: "Japanese", targetMarket: "Japan" }, "Asia/Tokyo"),
		);
		await vi.advanceTimersByTimeAsync(1);
		expect(observer.getCurrentResult().data?.report?.summary).toEqual(["日本語の提案"]);
		// Saved language is resolved on the server; callers cannot override it in the API request.
		expect(mocks.getReport).toHaveBeenCalledExactlyOnceWith({ data: { brandId: "brand", timezone: "Asia/Tokyo" } });
	});

	it("does not display or overwrite Japanese results with a late English request", async () => {
		let resolveEnglish!: (value: ReturnType<typeof report>) => void;
		mocks.getReport.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveEnglish = resolve;
				}),
		);
		const observer = new QueryObserver(client, opportunitiesQueryOptions("brand", { targetLanguage: "English" }));
		unsubscribe = observer.subscribe(() => {});
		await vi.advanceTimersByTimeAsync(1);
		observer.setOptions(opportunitiesQueryOptions("brand", { targetLanguage: "Japanese" }));
		expect(observer.getCurrentResult().data).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(observer.getCurrentResult().data?.report?.summary).toEqual(["日本語の提案"]);
		resolveEnglish(report("English recommendation"));
		await vi.advanceTimersByTimeAsync(1);
		expect(observer.getCurrentResult().data?.report?.summary).toEqual(["日本語の提案"]);
		expect(mocks.getReport).toHaveBeenCalledTimes(2);
	});

	it("refetches for market, timezone, and fallback app-language changes despite infinite freshness", async () => {
		for (const options of [
			opportunitiesQueryOptions("brand", {}, "Asia/Tokyo", "ja-JP"),
			opportunitiesQueryOptions("brand", {}, "Asia/Tokyo", "en-US"),
			opportunitiesQueryOptions("brand", {}, "UTC", "en-US"),
			opportunitiesQueryOptions("brand", { targetMarket: "Japan" }, "UTC", "en-US"),
		])
			await client.fetchQuery(options);
		expect(mocks.getReport).toHaveBeenCalledTimes(4);
	});

	it("invalidates all locale variants for one saved brand without refetching another brand", async () => {
		await client.fetchQuery(opportunitiesQueryOptions("brand-a", { targetLanguage: "Japanese" }));
		await client.fetchQuery(opportunitiesQueryOptions("brand-a", { targetLanguage: "English" }));
		await client.fetchQuery(opportunitiesQueryOptions("brand-b", { targetLanguage: "Japanese" }));
		mocks.getReport.mockClear();
		await client.invalidateQueries({ queryKey: opportunitiesKeys.detail("brand-a"), refetchType: "all" });
		expect(mocks.getReport).toHaveBeenCalledTimes(2);
		for (const [request] of mocks.getReport.mock.calls) expect(request.data.brandId).toBe("brand-a");
	});
});
