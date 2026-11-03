import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	lock: vi.fn(),
	recount: vi.fn(),
	enqueue: vi.fn(),
	findBrand: vi.fn(),
	findCompetitors: vi.fn(),
	set: vi.fn(),
	competitorValues: vi.fn(),
	promptValues: vi.fn(),
	schedule: vi.fn(),
	client: {},
}));
vi.mock("@workspace/lib/brand-mention-recount", () => ({
	withMentionTransaction: mocks.lock,
	startMentionRecount: mocks.recount,
}));
vi.mock("@/lib/mention-recount-client", () => ({ enqueueMentionRecount: mocks.enqueue }));
vi.mock("@/lib/job-scheduler", () => ({ createMultiplePromptJobSchedulers: mocks.schedule }));
vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: mocks.findBrand }, prompts: { findMany: async () => [] } },
		insert: () => ({ values: mocks.promptValues }),
	},
}));
vi.mock("drizzle-orm/node-postgres", () => ({
	drizzle: () => ({
		query: { brands: { findFirst: mocks.findBrand }, competitors: { findMany: mocks.findCompetitors } },
		update: () => ({ set: mocks.set }),
		select: () => ({ from: () => ({ where: async () => [{ count: 1 }] }) }),
		insert: () => ({ values: mocks.competitorValues }),
	}),
}));

import { saveWizardOnboarding, wizardOnboardingInputSchema } from "./onboarding-core";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.events = [];
	mocks.findBrand.mockResolvedValue({
		id: "rails",
		name: "Rails案件.com",
		website: "https://rails.example.com",
		additionalDomains: [],
		aliases: [],
		targetLanguage: "Japanese",
		targetMarket: "Japan",
		enabled: true,
		onboarded: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	mocks.findCompetitors.mockResolvedValue([
		{ id: "existing", name: "Existing Agent", aliases: [], domains: ["existing.example"] },
	]);
	mocks.set.mockImplementation(() => ({
		where: async () => {
			mocks.events.push("definition-save");
		},
	}));
	mocks.lock.mockImplementation(async (_brandId, action) => {
		mocks.events.push("lock");
		const result = await action(mocks.client);
		mocks.events.push("commit");
		return result;
	});
	mocks.recount.mockImplementation(async () => {
		mocks.events.push("recount-queued");
	});
	mocks.competitorValues.mockImplementation(async () => {
		mocks.events.push("competitors-added");
	});
	mocks.promptValues.mockImplementation(() => ({
		returning: async () => {
			mocks.events.push("prompts-added");
			return [{ id: "new-prompt" }];
		},
	}));
	mocks.schedule.mockImplementation(async () => {
		mocks.events.push("prompts-scheduled");
	});
});

describe("wizard definition save and recount", () => {
	it("keeps additive/name-only competitors and queues before committing, then schedules prompts outside the lock", async () => {
		const input = wizardOnboardingInputSchema.parse({
			brandId: "rails",
			brandName: "Rails案件.com",
			competitors: [
				{ name: "Existing Agent", domains: ["existing.example"] },
				{ name: "New Agent", domains: [] },
				{ name: "New Agent", domains: [] },
			],
			prompts: [{ value: "Rails案件を探して。" }],
		});
		await saveWizardOnboarding(input);
		expect(mocks.lock).toHaveBeenCalledWith("rails", expect.any(Function));
		expect(mocks.competitorValues).toHaveBeenCalledWith([
			{ brandId: "rails", name: "New Agent", domains: [], aliases: [] },
		]);
		expect(mocks.recount).toHaveBeenCalledWith(mocks.client, "rails", mocks.enqueue);
		expect(mocks.events.indexOf("recount-queued")).toBeLessThan(mocks.events.indexOf("commit"));
		expect(mocks.events.indexOf("commit")).toBeLessThan(mocks.events.indexOf("prompts-added"));
		expect(mocks.events.indexOf("commit")).toBeLessThan(mocks.events.indexOf("prompts-scheduled"));
	});
	it("does not insert or schedule prompts when the definition transaction cannot queue its recount", async () => {
		mocks.recount.mockRejectedValue(new Error("Queue unavailable"));
		await expect(
			saveWizardOnboarding(
				wizardOnboardingInputSchema.parse({
					brandId: "rails",
					aliases: ["Own Alias"],
					prompts: [{ value: "Rails案件を探して。" }],
				}),
			),
		).rejects.toThrow("Queue unavailable");
		expect(mocks.events).not.toContain("commit");
		expect(mocks.promptValues).not.toHaveBeenCalled();
		expect(mocks.schedule).not.toHaveBeenCalled();
	});
});
