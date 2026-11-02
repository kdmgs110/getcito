import { createHash, randomUUID } from "node:crypto";
import { resolveBrandLocale } from "../../brand-locale";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import { normalizePageEvidence } from "../../page-evidence";
import { extractCitationsFromDataforseoScraper } from "../../text-extraction";
import { type DataForSeoTaskStore, databaseDataForSeoTaskStore } from "../dataforseo-task-store";
import type { ModelConfig, Provider, ProviderOptions, ScrapeResult } from "../types";

// LLM Scraper collects ChatGPT's consumer Web surface. It is deliberately a
// different provider from DataForSEO LLM Responses (which calls model APIs).
const ENDPOINT = "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper";
const MAX_PROMPT_CHARACTERS = 2000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_WAIT_MS = 55 * 60_000;
const POLL_INTERVAL_MS = 30_000;

type JsonRecord = Record<string, unknown>;

export class DataForSeoScraperError extends Error {
	constructor(public readonly code: string) {
		super(`DataForSEO LLM Scraper: ${code}`);
	}
}

function object(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function targetError(config: Pick<ModelConfig, "model" | "version">): string | null {
	if (config.model !== "chatgpt") return "DataForSEO LLM Scraper only supports ChatGPT Web";
	if (config.version) return "DataForSEO LLM Scraper does not support selecting a model version";
	return null;
}

function encodeKeyword(prompt: string): string {
	if (!prompt.trim() || Array.from(prompt).length > MAX_PROMPT_CHARACTERS) {
		throw new DataForSeoScraperError("DataForSEO LLM Scraper prompts must contain 1 to 2000 characters");
	}
	// This endpoint URL-decodes keyword values even inside a JSON body. Escape
	// literal percent/plus characters once so C++, 50%, and %20 stay verbatim.
	const encoded = prompt.replaceAll("%", "%25").replaceAll("+", "%2B");
	if (Array.from(encoded).length > MAX_PROMPT_CHARACTERS) {
		throw new DataForSeoScraperError("DataForSEO LLM Scraper encoded prompt exceeds 2000 characters");
	}
	return encoded;
}

/** Normalize a single LLM Scraper response, never inferred query/source edges. */
export function normalizeDataForSeoScraperResponse(payload: unknown, prompt: string, webSearch: boolean): ScrapeResult {
	const response = object(payload);
	const task = Array.isArray(response?.tasks) ? object(response.tasks[0]) : undefined;
	const result = Array.isArray(task?.result) ? object(task.result[0]) : undefined;
	if (response?.status_code !== 20000 || task?.status_code !== 20000 || !result) {
		throw new DataForSeoScraperError("DataForSEO LLM Scraper task did not succeed");
	}
	const answerText = text(result.markdown);
	if (!answerText) throw new DataForSeoScraperError("DataForSEO LLM Scraper returned no answer text");
	const queries =
		webSearch && Array.isArray(result.fan_out_queries)
			? result.fan_out_queries.flatMap((value) => {
					const query = text(value);
					return query ? [query] : [];
				})
			: [];
	return {
		rawOutput: payload,
		textContent: answerText,
		webQueries: webSearch && queries.length === 0 ? [WEB_QUERIES_UNAVAILABLE] : queries,
		citations: extractCitationsFromDataforseoScraper(payload),
		modelVersion: text(result.model),
		measurement: {
			version: 1,
			answerText,
			answerStatus: "shown",
			queryStatus: !webSearch ? "not_used" : queries.length > 0 ? "observed" : "not_exposed",
			// fan_out_queries and answer-level sources do not tell us which
			// particular query retrieved which URL. Keep them separate.
			queryEvidence: [],
			pageEvidence: normalizePageEvidence(payload, { provider: "dataforseo-scraper", model: "chatgpt", webSearch }),
			submittedPrompt: prompt,
		},
	};
}

interface QueueRuntime {
	now(): number;
	wait(milliseconds: number): Promise<void>;
}

/** Injection is restricted to persistence/time; production always uses the standard queue. */
export function createDataForSeoScraper(
	store: DataForSeoTaskStore = databaseDataForSeoTaskStore,
	runtime: QueueRuntime = { now: Date.now, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
): Provider {
	return {
		id: "dataforseo-scraper",
		name: "ChatGPT Web",
		isConfigured() {
			return !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD;
		},
		validateTarget: targetError,
		async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
			try {
				const invalid = targetError({ model, version: options?.version });
				if (invalid) throw new DataForSeoScraperError(invalid);
				const keyword = encodeKeyword(prompt);
				const locale = resolveBrandLocale(options);
				const username = process.env.DATAFORSEO_LOGIN;
				const password = process.env.DATAFORSEO_PASSWORD;
				if (!username || !password) throw new DataForSeoScraperError("credentials are not configured");
				const webSearch = options?.webSearch ?? false;
				const payload = [
					{
						keyword,
						location_name: locale.countryName ?? "United States",
						language_code: locale.languageCode ?? "en",
						force_web_search: webSearch,
						priority: 1,
					},
				];
				const body = JSON.stringify(payload);
				const requestHash = createHash("sha256").update(body).digest("hex");
				// Workers pass a stable attempt/report key. Ad-hoc callers receive a unique
				// receipt too, so an ambiguous submission is still recorded for investigation.
				const key = options?.acquisitionKey ?? `adhoc:${randomUUID()}`;
				const { task: receipt, created } = await store.claim(key, requestHash);
				if (receipt.requestHash !== requestHash) throw new DataForSeoScraperError("request_changed");
				if (receipt.status === "failed") throw new DataForSeoScraperError(receipt.errorCode ?? "acquisition_failed");
				let taskId = receipt.taskId;
				if (options?.resumeOnly && !taskId) throw new DataForSeoScraperError("resume_task_missing");
				const headers = {
					Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
					"Content-Type": "application/json",
				};
				if (!taskId) {
					// The receipt is committed BEFORE POST. If the process dies between POST and
					// saving the ID, re-submitting is unsafe. An operator must reconcile it.
					if (!created) throw new DataForSeoScraperError("submission_unconfirmed");
					let response: Response;
					let submitted: JsonRecord | undefined;
					try {
						response = await fetch(`${ENDPOINT}/task_post`, {
							method: "POST",
							headers,
							body: JSON.stringify([{ ...payload[0], tag: createHash("sha256").update(key).digest("hex") }]),
							signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
						});
						submitted = object(await response.json());
					} catch {
						throw new DataForSeoScraperError("submission_unconfirmed");
					}
					const task = Array.isArray(submitted?.tasks) ? object(submitted.tasks[0]) : undefined;
					const code = Number(task?.status_code ?? submitted?.status_code);
					taskId = text(task?.id) ?? null;
					if (!response.ok || code !== 20100 || !taskId) {
						// Explicit task rejection is safe to classify; every other outcome remains
						// unconfirmed and can never cause an automatic second charge.
						const errorCode =
							code === 40200 || code === 40210 ? "payment_required" : `submission_rejected_${code || response.status}`;
						if (code >= 40000 && code < 50000) await store.failed(key, errorCode);
						throw new DataForSeoScraperError(code >= 40000 && code < 50000 ? errorCode : "submission_unconfirmed");
					}
					await options?.onBillableCall?.();
					try {
						await store.submitted(key, taskId);
					} catch {
						throw new DataForSeoScraperError("submission_unconfirmed");
					}
				}
				if (!/^[a-zA-Z0-9-]+$/.test(taskId)) throw new DataForSeoScraperError("invalid_task_id");
				const deadline = runtime.now() + MAX_WAIT_MS;
				await options?.onAcquisitionState?.("queued");
				while (runtime.now() < deadline) {
					let response: Response;
					let result: JsonRecord | undefined;
					try {
						response = await fetch(`${ENDPOINT}/task_get/advanced/${taskId}`, {
							headers,
							signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
						});
						result = object(await response.json());
					} catch {
						// Keep the worker lease alive during transport outages too;
						// recovery must not mistake an active poller for a crashed worker.
						await options?.onAcquisitionState?.("queued");
						await runtime.wait(POLL_INTERVAL_MS);
						continue;
					}
					const task = Array.isArray(result?.tasks) ? object(result.tasks[0]) : undefined;
					const code = Number(task?.status_code ?? result?.status_code);
					if (response.ok && result?.status_code === 20000 && code === 20000) {
						await options?.onAcquisitionState?.("running");
						return normalizeDataForSeoScraperResponse(result, prompt, webSearch);
					}
					if (
						[40601, 40602, 40603, 40202, 40209].includes(code) ||
						response.status === 429 ||
						response.status >= 500 ||
						code >= 50000
					) {
						await options?.onAcquisitionState?.("queued");
						await runtime.wait(POLL_INTERVAL_MS);
						continue;
					}
					const errorCode =
						code === 40200 || code === 40210 ? "payment_required" : `result_failed_${code || response.status}`;
					// The POST has already been paid for. Account/authentication errors
					// during a free GET must remain resumable after the account is fixed.
					if (![40200, 40210, 40100, 40104].includes(code) && ![401, 403].includes(response.status)) {
						await store.failed(key, errorCode);
					}
					throw new DataForSeoScraperError(errorCode);
				}
				// Keep the task ID: a job retry continues GET instead of submitting again.
				throw new DataForSeoScraperError("result_pending_timeout");
			} catch (error) {
				if (error instanceof DataForSeoScraperError) throw error;
				if (error instanceof Error && ["BRAND_LANGUAGE_INVALID", "BRAND_MARKET_INVALID"].includes(error.message))
					throw error;
				// Persistence/progress callbacks can also fail. Keep DB and upstream detail
				// out of provider-call logs while preserving the durable receipt.
				throw new DataForSeoScraperError("acquisition_failed");
			}
		},
	};
}

export const dataforseoScraper = createDataForSeoScraper();
