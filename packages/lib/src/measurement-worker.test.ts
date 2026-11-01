import type { Job } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementEvidence } from "./measurement";
import type { PromptRunRequestContext } from "./prompt-run-context";
import type { ScrapeResult } from "./providers/types";

const harness = vi.hoisted(() => ({
	run: vi.fn(),
	send: vi.fn(),
	findPrompt: vi.fn(),
	findBrand: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: {
			prompts: { findFirst: harness.findPrompt },
			brands: { findFirst: harness.findBrand },
			competitors: { findMany: vi.fn().mockResolvedValue([]) },
		},
		insert: harness.insert,
		update: harness.update,
		transaction: harness.transaction,
	},
}));
vi.mock("@workspace/lib/providers", async () => ({
	getProvider: () => ({ id: "brightdata", run: harness.run }),
	parseScrapeTargets: () => [
		{ model: "chatgpt", provider: "brightdata", webSearch: true },
		{ model: "google-ai-overview", provider: "brightdata", webSearch: true },
	],
	selectTargetsForBrand: (await import("./providers/runner")).selectTargetsForBrand,
	withProviderCallTracking: (_context: unknown, call: () => unknown) => call(),
}));
vi.mock("../../../apps/worker/src/boss", () => ({ default: { send: harness.send } }));
vi.mock("../../../apps/worker/src/telemetry", () => ({ trackWorkerEvent: vi.fn() }));
vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	// Keep conditions inspectable without connecting to a database.
	eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import { type ProcessPromptData, processPromptJob } from "../../../apps/worker/src/jobs/process-prompt";
import { measurementAttempts, promptRuns } from "./db/schema";

type Attempt = {
	id: string;
	targetKey: string;
	status: string;
	evidence?: MeasurementEvidence;
	promptRunId?: string | null;
	requestContext?: PromptRunRequestContext;
};
const attempts = new Map<string, Attempt>();
const answers: Array<Record<string, unknown>> = [];
let nextId = 0;

function evidence(answerStatus: MeasurementEvidence["answerStatus"] = "shown"): ScrapeResult {
	const answerText = answerStatus === "shown" ? "日本語の回答です。" : "";
	return {
		rawOutput: { answer_text: answerText },
		textContent: answerText,
		webQueries: [],
		citations: [],
		measurement: { version: 1, answerText, answerStatus, queryStatus: "not_exposed", queryEvidence: [] },
	};
}

function job(data: Partial<ProcessPromptData> = {}): Job<ProcessPromptData> {
	return {
		id: "job-1",
		data: { promptId: "prompt-1", singleRun: true, measurementBatchId: "batch-1", ...data },
	} as Job<ProcessPromptData>;
}

beforeEach(() => {
	vi.clearAllMocks();
	attempts.clear();
	answers.length = 0;
	nextId = 0;
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	harness.findPrompt.mockResolvedValue({
		id: "prompt-1",
		brandId: "brand-1",
		value: "おすすめの案件は？",
		enabled: true,
	});
	harness.findBrand.mockResolvedValue({
		id: "brand-1",
		name: "ブランド",
		website: "https://example.com",
		enabled: true,
		targetLanguage: "Japanese",
		targetMarket: "Japan",
		delayOverrideHours: 24,
	});
	harness.run.mockResolvedValue(evidence());
	harness.insert.mockImplementation((table: unknown) => ({
		values: (values: Record<string, unknown>) => {
			if (table === measurementAttempts) {
				return {
					onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
						returning: async () => {
							const key = `${values.batchId}/${values.targetKey}/${values.iteration}`;
							const previous = attempts.get(key);
							if (previous && previous.status !== "failed") return [];
							const attempt: Attempt = previous
								? { ...previous, ...set }
								: {
										id: `attempt-${++nextId}`,
										targetKey: String(values.targetKey),
										status: "running",
										requestContext: values.requestContext as PromptRunRequestContext,
									};
							attempts.set(key, attempt);
							return [attempt];
						},
					}),
				};
			}
			if (table === promptRuns) {
				answers.push(values);
				return { returning: async () => [{ id: `answer-${answers.length}`, createdAt: new Date() }] };
			}
			return Promise.resolve();
		},
	}));
	harness.update.mockImplementation(() => ({
		set: (values: Record<string, unknown>) => ({
			where: async (condition: { value: string }) => {
				const attempt = [...attempts.values()].find((item) => item.id === condition.value);
				if (attempt) Object.assign(attempt, values);
			},
		}),
	}));
	harness.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
		callback({ insert: harness.insert, update: harness.update }),
	);
});

afterEach(() => vi.restoreAllMocks());

describe("bounded Web measurement jobs", () => {
	it("stores an absent Overview observation without inventing an answer or rescheduling the one-off", async () => {
		harness.run.mockImplementation(async (model: string) =>
			evidence(model === "google-ai-overview" ? "not_shown" : "shown"),
		);
		await processPromptJob([job()]);
		expect(answers.map((answer) => answer.model)).toEqual(["chatgpt"]);
		expect([...attempts.values()].find((attempt) => attempt.targetKey.startsWith("google-ai-overview"))).toMatchObject({
			status: "succeeded",
			promptRunId: null,
			rawOutput: { answer_text: "" },
			evidence: { answerStatus: "not_shown" },
		});
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("retries only the failed half of a pair and preserves the successful answer", async () => {
		let failOverview = true;
		harness.run.mockImplementation(async (model: string) => {
			if (model === "google-ai-overview" && failOverview) throw new Error("acquisition failed");
			return evidence();
		});
		await expect(processPromptJob([job()])).rejects.toThrow("MEASUREMENT_BATCH_PARTIALLY_FAILED");
		expect(answers.map((answer) => answer.model)).toEqual(["chatgpt"]);
		expect([...attempts.values()].map((attempt) => attempt.status).sort()).toEqual(["failed", "succeeded"]);
		failOverview = false;
		await processPromptJob([job()]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual([
			"chatgpt",
			"google-ai-overview",
			"google-ai-overview",
		]);
		expect(answers.map((answer) => answer.model)).toEqual(["chatgpt", "google-ai-overview"]);
		expect([...attempts.values()].every((attempt) => attempt.status === "succeeded")).toBe(true);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("does not submit paid calls for a duplicate batch with active or completed claims", async () => {
		attempts.set("batch-1/chatgpt:brightdata:online/1", {
			id: "active",
			targetKey: "chatgpt:brightdata:online",
			status: "running",
		});
		attempts.set("batch-1/google-ai-overview:brightdata:online/1", {
			id: "complete",
			targetKey: "google-ai-overview:brightdata:online",
			status: "succeeded",
		});
		await processPromptJob([job()]);
		expect(harness.run).not.toHaveBeenCalled();
		expect(answers).toEqual([]);
	});

	it("records the updated submitted prompt and locale when reclaiming a failed attempt", async () => {
		const targetKeys = ["chatgpt:brightdata:online"];
		harness.run.mockRejectedValueOnce(new Error("temporary acquisition failure"));
		await expect(processPromptJob([job({ targetKeys })])).rejects.toThrow("MEASUREMENT_BATCH_PARTIALLY_FAILED");
		const key = "batch-1/chatgpt:brightdata:online/1";
		expect(attempts.get(key)?.requestContext).toMatchObject({
			prompt: "おすすめの案件は？",
			targetLanguage: "Japanese",
			targetMarket: "Japan",
		});
		harness.findPrompt.mockResolvedValue({
			id: "prompt-1",
			brandId: "brand-1",
			value: "Which projects are recommended?",
			enabled: true,
		});
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			name: "Brand",
			website: "https://example.com",
			enabled: true,
			targetLanguage: "English",
			targetMarket: "US",
		});
		await processPromptJob([job({ targetKeys })]);
		expect(harness.run).toHaveBeenLastCalledWith(
			"chatgpt",
			"Which projects are recommended?",
			expect.objectContaining({ targetLanguage: "English", targetMarket: "United States" }),
		);
		expect(attempts.get(key)?.requestContext).toEqual(answers[0].requestContext);
		expect(attempts.get(key)?.requestContext).toMatchObject({
			prompt: "Which projects are recommended?",
			targetLanguage: "English",
			targetMarket: "United States",
			languageCode: "en",
			countryCode: "US",
		});
		expect(harness.run).toHaveBeenCalledTimes(2);
	});

	it("does not save malformed acquisitions as successful answers", async () => {
		harness.run.mockResolvedValue(evidence("unknown"));
		await expect(processPromptJob([job()])).rejects.toThrow("MEASUREMENT_BATCH_PARTIALLY_FAILED");
		expect(answers).toEqual([]);
		expect([...attempts.values()].map((attempt) => attempt.status)).toEqual(["failed", "failed"]);
	});

	it("keeps recurring scheduling for regular jobs and sends the stored brand locale", async () => {
		await processPromptJob([job({ singleRun: false })]);
		expect(harness.send).toHaveBeenCalledTimes(1);
		expect(harness.send.mock.calls[0][1]).toMatchObject({ promptId: "prompt-1", cadenceHours: 24 });
		expect(harness.run).toHaveBeenCalledWith(
			"chatgpt",
			"おすすめの案件は？",
			expect.objectContaining({ targetLanguage: "Japanese", targetMarket: "Japan", webSearch: true }),
		);
	});

	it("can remeasure only an explicitly requested surface", async () => {
		await processPromptJob([job({ targetKeys: ["google-ai-overview:brightdata:online"] })]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["google-ai-overview"]);
		expect(answers).toHaveLength(1);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("discards a settings-change job after its requested targets have been deselected or removed", async () => {
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			enabled: true,
			enabledTargets: ["chatgpt:brightdata:online"],
		});
		await processPromptJob([
			job({
				settingsChange: true,
				targetKeys: ["google-ai-overview:brightdata:online", "chatgpt:removed-provider:online"],
			}),
		]);
		expect(harness.run).not.toHaveBeenCalled();
		expect(attempts.size).toBe(0);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("measures only the requested settings targets that are still currently enabled", async () => {
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			name: "Brand",
			website: "https://example.com",
			enabled: true,
			enabledTargets: ["chatgpt:brightdata:online"],
		});
		await processPromptJob([
			job({
				settingsChange: true,
				targetKeys: ["google-ai-overview:brightdata:online", "chatgpt:brightdata:online"],
			}),
		]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["chatgpt"]);
		expect(answers.map((answer) => answer.model)).toEqual(["chatgpt"]);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("preserves an explicit manual one-off override of the selected brand targets", async () => {
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			name: "Brand",
			website: "https://example.com",
			enabled: true,
			enabledTargets: ["chatgpt:brightdata:online"],
		});
		await processPromptJob([job({ targetKeys: ["google-ai-overview:brightdata:online"] })]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["google-ai-overview"]);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("does not expand an older settings job to targets enabled by a later change", async () => {
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			name: "Brand",
			website: "https://example.com",
			enabled: true,
			enabledTargets: ["chatgpt:brightdata:online", "google-ai-overview:brightdata:online"],
		});
		await processPromptJob([job({ settingsChange: true, targetKeys: ["chatgpt:brightdata:online"] })]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["chatgpt"]);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it.each([
		"prompt",
		"brand",
	] as const)("skips settings-change measurements when the %s is disabled without rescheduling", async (disabled) => {
		if (disabled === "prompt")
			harness.findPrompt.mockResolvedValue({ id: "prompt-1", brandId: "brand-1", enabled: false });
		else harness.findBrand.mockResolvedValue({ id: "brand-1", enabled: false });
		await processPromptJob([job({ settingsChange: true, targetKeys: ["chatgpt:brightdata:online"] })]);
		expect(harness.run).not.toHaveBeenCalled();
		expect(attempts.size).toBe(0);
		expect(harness.send).not.toHaveBeenCalled();
	});
});
