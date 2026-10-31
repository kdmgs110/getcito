import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findBrand: vi.fn(), set: vi.fn(), where: vi.fn() }));
vi.mock("@workspace/lib/db/db", () => ({
	db: { query: { brands: { findFirst: mocks.findBrand } }, update: () => ({ set: mocks.set }) },
}));
vi.mock("@/lib/job-scheduler", () => ({ createMultiplePromptJobSchedulers: vi.fn() }));

import { updateBrand, updateBrandBodySchema, wizardOnboardingInputSchema } from "./onboarding-core";

const brand = {
	id: "rails",
	name: "Rails案件",
	website: "https://rails.example.com",
	additionalDomains: [],
	aliases: [],
	targetLanguage: "Japanese",
	targetMarket: "Japan",
	enabled: true,
	onboarded: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.findBrand.mockResolvedValue(brand);
	mocks.set.mockReturnValue({ where: mocks.where });
	mocks.where.mockResolvedValue(undefined);
});
describe("brand locale persistence", () => {
	it("does not clear language or market during an unrelated partial update", async () => {
		await updateBrand({ brandId: "rails", brandName: "Rails案件.com" });
		const patch = mocks.set.mock.calls[0][0];
		expect(patch).toMatchObject({ name: "Rails案件.com" });
		expect(patch).not.toHaveProperty("targetLanguage");
		expect(patch).not.toHaveProperty("targetMarket");
	});
	it("saves normalized names and allows explicitly clearing a locale field", async () => {
		await updateBrand({ brandId: "rails", targetLanguage: "ja-JP", targetMarket: null });
		expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ targetLanguage: "Japanese", targetMarket: null }));
	});
	it("validates wizard and external API locale values before persistence", () => {
		expect(
			wizardOnboardingInputSchema.parse({ brandId: "rails", targetLanguage: "Japanese", targetMarket: "Japan" }),
		).toMatchObject({ targetLanguage: "Japanese", targetMarket: "Japan" });
		expect(updateBrandBodySchema.safeParse({ targetLanguage: "invented" }).success).toBe(false);
		expect(wizardOnboardingInputSchema.safeParse({ brandId: "rails", targetMarket: "Atlantis" }).success).toBe(false);
	});
});
