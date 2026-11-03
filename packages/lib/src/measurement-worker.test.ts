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
	execute: vi.fn(),
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: {
			prompts: { findFirst: harness.findPrompt },
			brands: { findFirst: harness.findBrand },
			competitors: { findMany: vi.fn().mockResolvedValue([]) },
			measurementAttempts: {
				findFirst: async ({ where }: { where: { value: string } }) =>
					[...attempts.values()].find((attempt) => attempt.id === where.value),
			},
		},
		insert: harness.insert,
		update: harness.update,
		transaction: harness.transaction,
		execute: harness.execute,
	},
}));
vi.mock("@workspace/lib/providers", async () => ({
	getProvider: (provider: string) => ({ id: provider, run: harness.run }),
	parseScrapeTargets: () => [
		{ model: "chatgpt", provider: "dataforseo-scraper", webSearch: true },
		{ model: "google-ai-overview", provider: "cloro", webSearch: true },
	],
	selectTargetsForBrand: (await import("./providers/runner")).selectTargetsForBrand,
	withProviderCallTracking: (_context: unknown, call: () => unknown) => call(),
}));
vi.mock("../../../apps/worker/src/boss", () => ({ default: { send: harness.send } }));
vi.mock("../../../apps/worker/src/telemetry", () => ({ trackWorkerEvent: vi.fn() }));
vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	// Keep conditions inspectable without connecting to a database.
	eq: (column: unknown, value: unknown) => ({ operator: "eq", column, value }),
	lt: (column: unknown, value: unknown) => ({ operator: "lt", column, value }),
	and: (...conditions: unknown[]) => ({ operator: "and", conditions: conditions.filter(Boolean) }),
	or: (...conditions: unknown[]) => ({ operator: "or", conditions: conditions.filter(Boolean) }),
}));

import { type ProcessPromptData, processPromptJob } from "../../../apps/worker/src/jobs/process-prompt";
import { brands, measurementAttempts, promptRuns } from "./db/schema";

type Attempt = {
	id: string;
	targetKey: string;
	status: string;
	evidence?: MeasurementEvidence;
	promptRunId?: string | null;
	requestContext?: PromptRunRequestContext;
	startedAt?: Date;
	[key: string]: unknown;
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

function matches(
	condition: { operator: string; column?: { name: string }; value?: unknown; conditions?: unknown[] },
	attempt: Attempt,
): boolean {
	if (condition.operator === "and")
		return (condition.conditions ?? []).every((item) => matches(item as typeof condition, attempt));
	if (condition.operator === "or")
		return (condition.conditions ?? []).some((item) => matches(item as typeof condition, attempt));
	const value = condition.column?.name === "started_at" ? attempt.startedAt : attempt[condition.column?.name ?? ""];
	if (condition.operator === "eq") return value === condition.value;
	if (condition.operator === "lt")
		return value instanceof Date && condition.value instanceof Date && value < condition.value;
	return false;
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
		aliases: [],
		additionalDomains: [],
		enabled: true,
		targetLanguage: "Japanese",
		targetMarket: "Japan",
		delayOverrideHours: 24,
	});
	harness.run.mockResolvedValue(evidence());
	harness.execute.mockResolvedValue({ rows: [] });
	harness.insert.mockImplementation((table: unknown) => ({
		values: (values: Record<string, unknown>) => {
			if (table === measurementAttempts) {
				return {
					onConflictDoUpdate: ({
						set,
						setWhere,
					}: {
						set: Record<string, unknown>;
						setWhere: Parameters<typeof matches>[0];
					}) => ({
						returning: async () => {
							const key = `${values.batchId}/${values.targetKey}/${values.iteration}`;
							const previous = attempts.get(key);
							if (previous && !matches(setWhere, previous)) return [];
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
		callback({
			insert: harness.insert,
			update: harness.update,
			execute: harness.execute,
			select: () => ({
				from: (table: unknown) => ({
					where: () => (table === brands ? { limit: async () => [await harness.findBrand()] } : Promise.resolve([])),
				}),
			}),
		}),
	);
});

afterEach(() => vi.restoreAllMocks());

describe("bounded Web measurement jobs", () => {
	it("uses brand definitions current when a delayed answer is saved", async () => {
		harness.run.mockImplementation(async () => {
			harness.findBrand.mockResolvedValue({
				id: "brand-1",
				name: "New Brand",
				aliases: ["New Alias"],
				website: "https://new.example",
				additionalDomains: [],
				enabled: true,
			});
			const answer = evidence();
			if (!answer.measurement) throw new Error("Expected evidence");
			answer.measurement.answerText = "1. New Alias";
			answer.textContent = "1. New Alias";
			return answer;
		});
		await processPromptJob([job({ targetKeys: ["chatgpt:dataforseo-scraper:online"] })]);
		expect(answers[0]).toMatchObject({
			brandMentioned: true,
			mentionAnalysis: { mentions: [{ entityId: "brand-1", name: "New Brand", kind: "own", rank: 1 }] },
		});
	});
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
		attempts.set("batch-1/chatgpt:dataforseo-scraper:online/1", {
			id: "active",
			targetKey: "chatgpt:dataforseo-scraper:online",
			status: "running",
		});
		attempts.set("batch-1/google-ai-overview:cloro:online/1", {
			id: "complete",
			targetKey: "google-ai-overview:cloro:online",
			status: "succeeded",
		});
		await processPromptJob([job()]);
		expect(harness.run).not.toHaveBeenCalled();
		expect(answers).toEqual([]);
	});

	it("immediately resumes a fresh paid-task claim on a pg-boss retry without treating it as completed", async () => {
		const key = "batch-1/chatgpt:dataforseo-scraper:online/1";
		attempts.set(key, {
			id: "fresh-paid",
			targetKey: "chatgpt:dataforseo-scraper:online",
			status: "queued",
			startedAt: new Date(),
		});
		await processPromptJob([job({ targetKeys: ["chatgpt:dataforseo-scraper:online"] })]);
		expect(harness.run).not.toHaveBeenCalled();
		const retried = Object.assign(job({ targetKeys: ["chatgpt:dataforseo-scraper:online"] }), { retryCount: 1 });
		await processPromptJob([retried]);
		expect(harness.run).toHaveBeenCalledWith(
			"chatgpt",
			expect.any(String),
			expect.objectContaining({ acquisitionKey: "measurement:fresh-paid" }),
		);
		expect(attempts.get(key)?.status).toBe("succeeded");
		expect(answers).toHaveLength(1);
	});

	it("recovers exactly the stored iteration and original request context using free-GET-only mode", async () => {
		const key = "batch-1/chatgpt:dataforseo-scraper:online/1";
		const original: PromptRunRequestContext = {
			version: 1,
			prompt: "Original prompt",
			targetLanguage: "Japanese",
			targetMarket: "Japan",
			languageCode: "ja",
			countryCode: "JP",
		};
		attempts.set(key, {
			id: "orphaned",
			promptId: "prompt-1",
			batchId: "batch-1",
			model: "chatgpt",
			provider: "dataforseo-scraper",
			webSearchEnabled: true,
			iteration: 1,
			targetKey: "chatgpt:dataforseo-scraper:online",
			status: "queued",
			startedAt: new Date(Date.now() - 21 * 60_000),
			requestContext: original,
		});
		await processPromptJob([job({ resumeDataForSeoAttemptId: "orphaned" })]);
		expect(harness.run).toHaveBeenCalledTimes(1);
		expect(harness.run).toHaveBeenCalledWith(
			"chatgpt",
			"Original prompt",
			expect.objectContaining({ acquisitionKey: "measurement:orphaned", resumeOnly: true, targetMarket: "Japan" }),
		);
		expect(answers[0].requestContext).toEqual(original);
		await processPromptJob([job({ resumeDataForSeoAttemptId: "orphaned" })]);
		expect(harness.run).toHaveBeenCalledTimes(1);
	});

	it("does not recover a previously paid task after ChatGPT Web is disabled", async () => {
		harness.findBrand.mockResolvedValue({ id: "brand-1", enabled: true, enabledTargets: [] });
		attempts.set("batch-1/chatgpt:dataforseo-scraper:online/1", {
			id: "disabled",
			promptId: "prompt-1",
			model: "chatgpt",
			provider: "dataforseo-scraper",
			status: "queued",
			targetKey: "chatgpt:dataforseo-scraper:online",
		});
		await processPromptJob([job({ resumeDataForSeoAttemptId: "disabled" })]);
		expect(harness.run).not.toHaveBeenCalled();
	});

	it("does not buy a new recurring scrape while an earlier paid task needs recovery", async () => {
		harness.execute.mockResolvedValue({ rows: [{ pending: true }] });
		await processPromptJob([job({ singleRun: false })]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["google-ai-overview"]);
	});

	it("records the updated submitted prompt and locale when reclaiming a failed attempt", async () => {
		const targetKeys = ["chatgpt:dataforseo-scraper:online"];
		harness.run.mockRejectedValueOnce(new Error("temporary acquisition failure"));
		await expect(processPromptJob([job({ targetKeys })])).rejects.toThrow("MEASUREMENT_BATCH_PARTIALLY_FAILED");
		const key = "batch-1/chatgpt:dataforseo-scraper:online/1";
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

	it("normalizes a pre-cutover job to ChatGPT Web and records queue progress with a stable receipt key", async () => {
		harness.run.mockImplementation(
			async (
				_model: string,
				_prompt: string,
				options: {
					acquisitionKey: string;
					onAcquisitionState: (state: "queued" | "running") => Promise<void>;
				},
			) => {
				expect(options.acquisitionKey).toBe("measurement:attempt-1");
				await options.onAcquisitionState("queued");
				expect([...attempts.values()][0].status).toBe("queued");
				await options.onAcquisitionState("running");
				return evidence();
			},
		);
		await processPromptJob([job({ targetKeys: ["chatgpt:brightdata:online"] })]);
		expect(harness.run).toHaveBeenCalledTimes(1);
		expect(answers[0]).toMatchObject({ model: "chatgpt", provider: "dataforseo-scraper" });
		expect([...attempts.values()][0].status).toBe("succeeded");
	});

	it("stores a safe payment failure category for the queued acquisition", async () => {
		harness.run.mockRejectedValue(Object.assign(new Error("upstream account detail"), { code: "payment_required" }));
		await expect(processPromptJob([job({ targetKeys: ["chatgpt:dataforseo-scraper:online"] })])).rejects.toThrow(
			"MEASUREMENT_BATCH_PARTIALLY_FAILED",
		);
		expect([...attempts.values()][0]).toMatchObject({ status: "failed", errorCode: "payment_required" });
		expect(answers).toHaveLength(0);
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
		await processPromptJob([job({ targetKeys: ["google-ai-overview:cloro:online"] })]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["google-ai-overview"]);
		expect(answers).toHaveLength(1);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("discards a settings-change job after its requested targets have been deselected or removed", async () => {
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			enabled: true,
			enabledTargets: ["chatgpt:dataforseo-scraper:online"],
		});
		await processPromptJob([
			job({
				settingsChange: true,
				targetKeys: ["google-ai-overview:cloro:online", "chatgpt:removed-provider:online"],
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
			enabledTargets: ["chatgpt:dataforseo-scraper:online"],
		});
		await processPromptJob([
			job({
				settingsChange: true,
				targetKeys: ["google-ai-overview:cloro:online", "chatgpt:dataforseo-scraper:online"],
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
			enabledTargets: ["chatgpt:dataforseo-scraper:online"],
		});
		await processPromptJob([job({ targetKeys: ["google-ai-overview:cloro:online"] })]);
		expect(harness.run.mock.calls.map(([model]) => model)).toEqual(["google-ai-overview"]);
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("does not expand an older settings job to targets enabled by a later change", async () => {
		harness.findBrand.mockResolvedValue({
			id: "brand-1",
			name: "Brand",
			website: "https://example.com",
			enabled: true,
			enabledTargets: ["chatgpt:dataforseo-scraper:online", "google-ai-overview:cloro:online"],
		});
		await processPromptJob([job({ settingsChange: true, targetKeys: ["chatgpt:dataforseo-scraper:online"] })]);
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
		await processPromptJob([job({ settingsChange: true, targetKeys: ["chatgpt:dataforseo-scraper:online"] })]);
		expect(harness.run).not.toHaveBeenCalled();
		expect(attempts.size).toBe(0);
		expect(harness.send).not.toHaveBeenCalled();
	});
});
