import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const records = vi.hoisted(() => ({ values: vi.fn() }));
vi.mock("../db/db", () => ({ db: { insert: () => ({ values: records.values }) } }));

import { withProviderCallTracking } from "./usage";

beforeEach(() => {
	vi.clearAllMocks();
	records.values.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
const meta = { provider: "dataforseo-scraper", model: "chatgpt", kind: "run" as const };
describe("confirmed billable request accounting", () => {
	it("records a confirmed POST exactly once and skips a resumed free GET", async () => {
		await withProviderCallTracking(
			meta,
			async (paid) => {
				await paid();
				return "posted and polled";
			},
			{ billableOnCallback: true },
		);
		await withProviderCallTracking(meta, async () => "resumed free GET", { billableOnCallback: true });
		expect(records.values).toHaveBeenCalledTimes(1);
		expect(records.values).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "dataforseo-scraper", success: true }),
		);
	});
	it("does not count rejected or unconfirmed submissions as confirmed billable calls", async () => {
		await expect(
			withProviderCallTracking(
				meta,
				async () => {
					throw new Error("payment_required");
				},
				{ billableOnCallback: true },
			),
		).rejects.toThrow("payment_required");
		expect(records.values).not.toHaveBeenCalled();
	});
	it("still records a paid POST whose later result retrieval failed", async () => {
		await expect(
			withProviderCallTracking(
				meta,
				async (paid) => {
					paid();
					throw new Error("result_pending_timeout");
				},
				{ billableOnCallback: true },
			),
		).rejects.toThrow("result_pending_timeout");
		expect(records.values).toHaveBeenCalledTimes(1);
		expect(records.values).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
	});
	it("preserves existing accounting for other providers", async () => {
		await withProviderCallTracking({ ...meta, provider: "cloro" }, async () => "answer");
		expect(records.values).toHaveBeenCalledTimes(1);
	});
});
