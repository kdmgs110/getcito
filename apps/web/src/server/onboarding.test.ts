import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	findBrand: vi.fn(),
	prompts: vi.fn(),
	brand: vi.fn(),
	enqueue: vi.fn(),
	status: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (input: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@workspace/lib/db/db", () => ({ db: { query: { brands: { findFirst: mocks.findBrand } } } }));
vi.mock("@workspace/lib/onboarding", () => ({
	analyzePrompts: mocks.prompts,
	analyzeBrand: mocks.brand,
	analyzeCompetitors: vi.fn(),
}));
vi.mock("@/lib/analyze-brand-job", () => ({
	enqueueAnalyzeBrand: mocks.enqueue,
	getAnalyzeBrandStatus: mocks.status,
	cancelAnalyzeBrand: vi.fn(),
}));
vi.mock("@/server/onboarding-core", () => ({
	saveWizardOnboarding: vi.fn(),
	wizardOnboardingInputSchema: { parse: (input: unknown) => input },
}));
vi.mock("./onboarding-translations", () => ({ translateBrandPrompts: vi.fn() }));

import { analyzePromptsFn, getAnalyzeBrandStatusFn, startAnalyzeBrandFn } from "./onboarding";

const input = { brandId: "rails", brandName: "Rails案件", website: "rails.example.com" };
beforeEach(() => {
	vi.clearAllMocks();
	mocks.auth.mockResolvedValue({ user: { id: "owner" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.findBrand.mockResolvedValue({ targetLanguage: "Japanese", targetMarket: "Japan" });
	mocks.prompts.mockResolvedValue({ suggestedPrompts: [] });
});
describe("authorized onboarding generation", () => {
	it("loads the stored brand locale rather than trusting a client default", async () => {
		await analyzePromptsFn({ data: input });
		expect(mocks.access).toHaveBeenCalledWith("owner", "rails");
		expect(mocks.prompts).toHaveBeenCalledWith({
			website: input.website,
			brandName: input.brandName,
			competitorNames: undefined,
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
	});
	it("allows a validated unsaved wizard selection for start and status", async () => {
		await startAnalyzeBrandFn({ data: { ...input, targetLanguage: "en", targetMarket: null } });
		await getAnalyzeBrandStatusFn({ data: { brandId: "rails", targetLanguage: "en", targetMarket: null } });
		expect(mocks.enqueue).toHaveBeenCalledWith({ ...input, targetLanguage: "English", targetMarket: null });
		expect(mocks.status).toHaveBeenCalledWith("rails", { targetLanguage: "English", targetMarket: null });
	});
	it("denies unauthorized access before reading settings or generating anything", async () => {
		mocks.access.mockRejectedValueOnce(new Error("FORBIDDEN"));
		await expect(analyzePromptsFn({ data: input })).rejects.toThrow("FORBIDDEN");
		expect(mocks.findBrand).not.toHaveBeenCalled();
		expect(mocks.prompts).not.toHaveBeenCalled();
	});
	it("rejects an invalid preview before making a paid API request", async () => {
		expect(() => analyzePromptsFn({ data: { ...input, targetLanguage: "not a language" } })).toThrow(
			"BRAND_LANGUAGE_INVALID",
		);
		expect(mocks.prompts).not.toHaveBeenCalled();
	});
});
