import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataForSeoTask, DataForSeoTaskStore } from "../dataforseo-task-store";
import { createDataForSeoScraper, normalizeDataForSeoScraperResponse } from "./dataforseo-scraper";

function payload(result: Record<string, unknown> = {}) {
	return {
		status_code: 20000,
		tasks: [{ status_code: 20000, result: [{ markdown: "日本語の回答", model: "actual-web-model", ...result }] }],
	};
}
function status(code: number, extra: Record<string, unknown> = {}) {
	return Response.json({ status_code: 20000, tasks: [{ status_code: code, ...extra }] });
}
function memoryStore() {
	const tasks = new Map<string, DataForSeoTask>();
	const store: DataForSeoTaskStore = {
		async claim(key, requestHash) {
			const existing = tasks.get(key);
			if (existing) return { task: { ...existing }, created: false };
			const task: DataForSeoTask = { key, requestHash, status: "submitting", taskId: null, errorCode: null };
			tasks.set(key, task);
			return { task: { ...task }, created: true };
		},
		async submitted(key, taskId) {
			const task = tasks.get(key);
			if (!task) throw new Error("missing receipt");
			Object.assign(task, { taskId, status: "submitted" });
		},
		async failed(key, errorCode) {
			const task = tasks.get(key);
			if (!task) throw new Error("missing receipt");
			Object.assign(task, { status: "failed", errorCode });
		},
	};
	return { tasks, store };
}
let memory: ReturnType<typeof memoryStore>;
let now = 0;
let provider: ReturnType<typeof createDataForSeoScraper>;
beforeEach(() => {
	vi.stubEnv("DATAFORSEO_LOGIN", "test-account");
	vi.stubEnv("DATAFORSEO_PASSWORD", "private-test-value");
	memory = memoryStore();
	now = 0;
	provider = createDataForSeoScraper(memory.store, {
		now: () => now,
		wait: async (ms) => {
			now += ms;
		},
	});
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("DataForSEO ChatGPT Web standard queue", () => {
	it("posts once with native locale, then polls without changing fan-out evidence", async () => {
		const raw = payload({ fan_out_queries: ["Rails フルリモート 案件", "Rails 単価 相場", "Rails フルリモート 案件"] });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockResolvedValueOnce(status(40602))
			.mockResolvedValueOnce(Response.json(raw));
		vi.stubGlobal("fetch", fetchMock);
		const progress = vi.fn();
		const result = await provider.run("chatgpt", "Rails案件を探して", {
			targetLanguage: "Japanese",
			targetMarket: "JP",
			webSearch: true,
			acquisitionKey: "attempt-1",
			onAcquisitionState: progress,
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const [url, request] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_post");
		expect(JSON.parse(request.body)).toEqual([
			{
				keyword: "Rails案件を探して",
				location_name: "Japan",
				language_code: "ja",
				force_web_search: true,
				priority: 1,
				tag: expect.any(String),
			},
		]);
		expect(fetchMock.mock.calls[1][0]).toBe(
			"https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/task-123",
		);
		expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
		expect(progress.mock.calls.map((args) => args[0])).toEqual(["queued", "queued", "running"]);
		expect(memory.tasks.get("attempt-1")).toMatchObject({ status: "submitted", taskId: "task-123" });
		expect(result).toMatchObject({
			rawOutput: raw,
			textContent: "日本語の回答",
			modelVersion: "actual-web-model",
			webQueries: ["Rails フルリモート 案件", "Rails 単価 相場", "Rails フルリモート 案件"],
			measurement: {
				submittedPrompt: "Rails案件を探して",
				answerStatus: "shown",
				queryStatus: "observed",
				queryEvidence: [],
			},
		});
	});
	it("never POSTs in recovery-only mode when the saved paid task is missing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "missing", resumeOnly: true })).rejects.toThrow(
			"resume_task_missing",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("signals one confirmed paid POST, but does not signal the resumed free GET", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockResolvedValueOnce(Response.json(payload()))
			.mockResolvedValueOnce(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		const onBillableCall = vi.fn();
		await provider.run("chatgpt", "original", { acquisitionKey: "paid", onBillableCall });
		await provider.run("chatgpt", "original", { acquisitionKey: "paid", onBillableCall, resumeOnly: true });
		expect(onBillableCall).toHaveBeenCalledTimes(1);
	});

	it("resumes the saved task after a polling deadline without another POST", async () => {
		provider = createDataForSeoScraper(memory.store, {
			now: () => now,
			wait: async () => {
				now += 56 * 60_000;
			},
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockResolvedValueOnce(status(40602))
			.mockResolvedValueOnce(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"result_pending_timeout",
		);
		// A fresh provider instance models a restarted worker using the same persisted receipt.
		const restarted = createDataForSeoScraper(memory.store, { now: () => now, wait: async () => {} });
		await expect(restarted.run("chatgpt", "original", { acquisitionKey: "stable" })).resolves.toMatchObject({
			textContent: "日本語の回答",
		});
		expect(fetchMock.mock.calls.filter(([, request]) => request.method === "POST")).toHaveLength(1);
	});
	it("never resubmits an ambiguous POST even after a worker restart", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("private-test-value upstream response"));
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"submission_unconfirmed",
		);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"submission_unconfirmed",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("prevents a concurrent duplicate while submission is in flight", async () => {
		let release!: (response: Response) => void;
		const posted = new Promise<Response>((resolve) => {
			release = resolve;
		});
		const fetchMock = vi.fn().mockReturnValueOnce(posted).mockResolvedValueOnce(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		const first = provider.run("chatgpt", "original", { acquisitionKey: "stable" });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"submission_unconfirmed",
		);
		release(status(20100, { id: "task-123" }));
		await expect(first).resolves.toMatchObject({ textContent: "日本語の回答" });
		expect(fetchMock.mock.calls.filter(([, request]) => request.method === "POST")).toHaveLength(1);
	});
	it("does not submit again when persisting a received task ID fails", async () => {
		vi.spyOn(memory.store, "submitted").mockRejectedValueOnce(new Error("database unavailable"));
		const fetchMock = vi.fn().mockResolvedValueOnce(status(20100, { id: "task-123" }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"submission_unconfirmed",
		);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"submission_unconfirmed",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("refuses changed input for the same acquisition key", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("transport failed"));
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"submission_unconfirmed",
		);
		await expect(provider.run("chatgpt", "changed", { acquisitionKey: "stable" })).rejects.toThrow("request_changed");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("records an explicit payment rejection without leaking response text or retrying", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ status_code: 20000, tasks: [{ status_code: 40200, status_message: "private-test-value" }] }),
					{ status: 402 },
				),
			);
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow("payment_required");
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow("payment_required");
		expect(memory.tasks.get("stable")).toMatchObject({ status: "failed", errorCode: "payment_required" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("resumes a paid task after a GET payment error without paying again", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 40200, tasks: null }), { status: 402 }))
			.mockResolvedValueOnce(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow("payment_required");
		expect(memory.tasks.get("stable")).toMatchObject({ status: "submitted", taskId: "task-123" });
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).resolves.toMatchObject({
			textContent: "日本語の回答",
		});
		expect(fetchMock.mock.calls.filter(([, request]) => request.method === "POST")).toHaveLength(1);
	});

	it("retries transient GET failures and preserves the original task", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockRejectedValueOnce(new Error("temporary transport failure"))
			.mockResolvedValueOnce(new Response("not json", { status: 503 }))
			.mockResolvedValueOnce(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		const progress = vi.fn();
		await expect(provider.run("chatgpt", "original", { onAcquisitionState: progress })).resolves.toMatchObject({
			textContent: "日本語の回答",
		});
		expect(progress.mock.calls.map(([state]) => state)).toEqual(["queued", "queued", "queued", "running"]);
		expect(fetchMock.mock.calls.filter(([, request]) => request.method === "POST")).toHaveLength(1);
	});
	it("treats a terminal result error as failed, rather than an empty successful answer", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockResolvedValueOnce(status(40102));
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", "original", { acquisitionKey: "stable" })).rejects.toThrow(
			"result_failed_40102",
		);
		expect(memory.tasks.get("stable")).toMatchObject({ status: "failed", taskId: "task-123" });
	});
	it("escapes endpoint percent/plus decoding without changing the submitted prompt", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(status(20100, { id: "task-123" }))
			.mockResolvedValueOnce(Response.json(payload()));
		vi.stubGlobal("fetch", fetchMock);
		const prompt = "C++ 50% %20 100%25";
		const result = await provider.run("chatgpt", prompt);
		const keyword = JSON.parse(fetchMock.mock.calls[0][1].body)[0].keyword;
		expect(keyword).toBe("C%2B%2B 50%25 %2520 100%2525");
		expect(decodeURIComponent(keyword.replaceAll("+", " "))).toBe(prompt);
		expect(result.measurement?.submittedPrompt).toBe(prompt);
	});
	it("keeps answer citations separate from unused search results and query edges", () => {
		const result = normalizeDataForSeoScraperResponse(
			payload({
				fan_out_queries: ["real query", " ", 42],
				sources: [
					{ url: "https://www.example.com/path?full=1", title: "Source" },
					{ url: "javascript:alert(1)" },
					{ url: "https://user:secret@example.com/" },
					{ url: "https://www.example.com/path?full=1" },
				],
				search_results: [{ url: "https://search-result.example/" }],
			}),
			"original",
			true,
		);
		expect(result.webQueries).toEqual(["real query"]);
		expect(result.citations).toEqual([
			{ url: "https://www.example.com/path?full=1", title: "Source", domain: "example.com", citationIndex: 0 },
		]);
		expect(result.measurement?.queryEvidence).toEqual([]);
	});
	it("distinguishes missing fan-out from disabled web search", () => {
		expect(normalizeDataForSeoScraperResponse(payload(), "original", true)).toMatchObject({
			webQueries: ["unavailable"],
			measurement: { queryStatus: "not_exposed" },
		});
		expect(normalizeDataForSeoScraperResponse(payload(), "original", false)).toMatchObject({
			webQueries: [],
			measurement: { queryStatus: "not_used" },
		});
	});
	it.each(["", " ", "x".repeat(2001), "+".repeat(1000)])("rejects invalid input before billing", async (prompt) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("chatgpt", prompt)).rejects.toThrow(/^DataForSEO LLM Scraper/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("rejects unsupported targets and locales before billing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(provider.run("gemini", "original")).rejects.toThrow("only supports ChatGPT Web");
		await expect(provider.run("chatgpt", "original", { version: "custom" })).rejects.toThrow(
			"does not support selecting a model version",
		);
		await expect(provider.run("chatgpt", "original", { targetLanguage: "Klingon" })).rejects.toThrow(
			"BRAND_LANGUAGE_INVALID",
		);
		await expect(provider.run("chatgpt", "original", { targetMarket: "Mars" })).rejects.toThrow("BRAND_MARKET_INVALID");
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("requires both DataForSEO credentials", async () => {
		vi.stubEnv("DATAFORSEO_PASSWORD", "");
		expect(provider.isConfigured()).toBe(false);
		await expect(provider.run("chatgpt", "original")).rejects.toThrow("credentials are not configured");
	});
});
