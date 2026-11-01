import { bdclient } from "@brightdata/sdk";
import { resolveBrandLocale } from "../../brand-locale";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import type { ModelConfig, Provider, ProviderOptions, ScrapeResult } from "../types";
import { BrightDataEvidenceError, normalizeBrightDataEvidence } from "./brightdata-evidence";

class BrightDataAcquisitionError extends Error {}

const BD_DATASET_IDS: Record<string, string> = {
	chatgpt: "gd_m7aof0k82r803d5bjm",
	perplexity: "gd_m7dhdot1vw9a7gc1n",
	copilot: "gd_m7di5jy6s9geokz8w",
	gemini: "gd_mbz66arm2mf9cu856y",
	grok: "gd_m8ve0u141icu75ae74",
	"google-ai-mode": "gd_mcswdt6z2elth3zqr2",
	"google-ai-overview": "gd_mfz5x93lmsjjjylob",
};

const BD_BASE_URL: Record<string, string> = {
	chatgpt: "https://chatgpt.com/",
	"google-ai-mode": "https://google.com/aimode",
	"google-ai-overview": "https://www.google.com/",
	gemini: "https://gemini.google.com/",
	copilot: "https://copilot.microsoft.com/chats",
	perplexity: "https://www.perplexity.ai/",
	grok: "https://grok.com/",
};

function createClient(): bdclient {
	return new bdclient({ apiKey: process.env.BRIGHTDATA_API_TOKEN });
}

export const brightdata: Provider = {
	id: "brightdata",
	name: "BrightData",

	isConfigured() {
		return !!process.env.BRIGHTDATA_API_TOKEN;
	},

	validateTarget(config: ModelConfig) {
		// Allow custom dataset IDs via version slug (e.g. chatgpt:brightdata:gd_abc123)
		if (!config.version && !BD_DATASET_IDS[config.model]) {
			return `BrightData does not support model "${config.model}". Supported: ${Object.keys(BD_DATASET_IDS).join(", ")}`;
		}
		// ChatGPT has a web search toggle; all other chatbots always search
		if (!config.webSearch && config.model !== "chatgpt") {
			return `${config.model}:brightdata requires :online — this chatbot always uses web search`;
		}
		return null;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const datasetId = options?.version ?? BD_DATASET_IDS[model];
		if (!datasetId) {
			throw new Error(
				`BrightData: no dataset ID for model "${model}". ` +
					`Either use a known model (${Object.keys(BD_DATASET_IDS).join(", ")}) ` +
					`or pass a dataset ID as the version slug: ${model}:brightdata:gd_abc123`,
			);
		}

		const client = createClient();
		let snapshotId: string | undefined;
		let consumed = false;
		try {
			const triggerUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&notify=false&include_errors=true&format=json`;

			const locale = resolveBrandLocale(options);

			const finalPrompt =
				locale.languageName && model !== "google-ai-mode" && model !== "google-ai-overview"
					? `${prompt}\nPlease provide your response in ${locale.languageName}.`
					: prompt;

			let payloadData: Record<string, unknown> = {
				url: BD_BASE_URL[model] ?? "",
				prompt: finalPrompt,
				index: 1,
				...(model === "chatgpt" ? { web_search: options?.webSearch ?? false } : {}),
				// ChatGPT validates countries against its uppercase ISO enum (JP works,
				// jp is rejected). Other existing engine contracts use lowercase.
				...(locale.countryCode
					? { country: model === "chatgpt" ? locale.countryCode : locale.countryCode.toLowerCase() }
					: {}),
				...(model === "google-ai-mode" ? { hl: locale.languageCode ?? "en" } : {}),
			};

			if (model === "google-ai-overview") {
				payloadData = {
					url: "https://www.google.com/",
					keyword: prompt,
					language: locale.languageCode ?? "en",
					country: locale.countryCode?.toLowerCase() ?? "us",
					start_page: 1,
					end_page: 1,
					collapse_aio: false,
				};
			}

			let triggerRes = await fetch(triggerUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([payloadData]),
			});

			if (triggerRes.status === 400) {
				const errorText = await triggerRes.text();
				if (errorText.includes('"country"')) {
					if (locale.countryCode)
						throw new BrightDataAcquisitionError("BrightData does not support the selected market for this engine");
					// The scraper doesn't support this specific country, retry without it
					delete payloadData.country;
					triggerRes = await fetch(triggerUrl, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify([payloadData]),
					});
				} else {
					throw new BrightDataAcquisitionError("BrightData trigger failed (400)");
				}
			}

			if (!triggerRes.ok) {
				throw new BrightDataAcquisitionError(`BrightData trigger failed (${triggerRes.status})`);
			}

			({ snapshot_id: snapshotId } = (await triggerRes.json()) as { snapshot_id: string });
			await pollUntilReady(snapshotId);

			let payload: Awaited<ReturnType<typeof client.scrape.snapshot.fetch>> | undefined;
			for (let i = 0; i < 5; i++) {
				try {
					payload = await client.scrape.snapshot.fetch(snapshotId, { format: "json" });
					break;
				} catch (err) {
					if (i === 4 || !(err instanceof Error) || !err.message.toLowerCase().includes("not ready")) throw err;
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}
			}
			consumed = true;

			const record = (Array.isArray(payload) ? payload[0] : payload) ?? {};
			const normalized = normalizeBrightDataEvidence(record, model, options?.webSearch ?? false, finalPrompt);

			// Retain raw protocol evidence (including response_raw) so actual searches
			// can be audited. Drop only HTML representations not used for extraction.
			const { answer_html, answer_section_html, page_html, ...trimmed } = record;
			const rawOutput = Array.isArray(payload) ? [trimmed] : trimmed;

			return {
				rawOutput,
				textContent: normalized.measurement.answerText,
				webQueries:
					normalized.measurement.queryStatus === "not_exposed" ? [WEB_QUERIES_UNAVAILABLE] : normalized.queries,
				citations: normalized.citations,
				modelVersion: normalized.modelVersion,
				measurement: normalized.measurement,
			};
		} catch (error) {
			if (
				error instanceof BrightDataAcquisitionError ||
				error instanceof BrightDataEvidenceError ||
				(error instanceof Error && ["BRAND_LANGUAGE_INVALID", "BRAND_MARKET_INVALID"].includes(error.message))
			) {
				throw error;
			}
			throw new Error("BrightData acquisition failed");
		} finally {
			// A triggered snapshot we never consumed (timeout, terminal failure, an
			// unknown status we gave up on, or any thrown error) keeps running on
			// BrightData and counts against the per-dataset concurrency cap — which
			// eventually 429s even healthy triggers. Best-effort cancel so abandoned
			// jobs don't accumulate. (Worker SIGTERM mid-poll still leaks; those need
			// the periodic snapshot sweep.)
			if (snapshotId && !consumed) await cancelSnapshot(client, snapshotId);
			try {
				await client.close();
			} catch {
				console.warn("BrightData client cleanup failed");
			}
		}
	},
};

/** Terminal failure statuses from datasets/v3/progress. Anything else —
 *  running, building, "starting", queued, or a status BrightData adds later —
 *  is treated as "still working" so a degraded scraper or an unrecognized
 *  status string doesn't fail the run on the very first poll. */
const TERMINAL_FAILURE = new Set(["failed", "error", "cancelled"]);

async function pollUntilReady(snapshotId: string): Promise<void> {
	const maxAttempts = 60;
	const BASE_DELAY = 2000;
	const MAX_DELAY = 10000;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const status = await getSnapshotStatus(snapshotId);
		if (status === "ready") return;
		if (TERMINAL_FAILURE.has(status)) {
			throw new BrightDataAcquisitionError(`BrightData snapshot ${snapshotId} ${status}`);
		}

		const delay = Math.min(BASE_DELAY * 2 ** Math.floor(attempt / 5), MAX_DELAY);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	throw new BrightDataAcquisitionError(`BrightData snapshot ${snapshotId} timed out`);
}

/** Read snapshot status straight from datasets/v3/progress. We bypass the SDK's
 *  getStatus because its response schema is a strict enum
 *  (running|ready|failed|cancelled|error) that throws on any other value — and the
 *  live API also returns statuses like "starting", which would otherwise fail the
 *  run instantly instead of waiting. A transient HTTP/parse error is reported as a
 *  non-terminal status so we keep polling rather than abandon the snapshot. */
async function getSnapshotStatus(snapshotId: string): Promise<string> {
	try {
		const res = await fetch(`https://api.brightdata.com/datasets/v3/progress/${snapshotId}`, {
			headers: { Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}` },
		});
		if (!res.ok) return "pending";
		const body = (await res.json()) as { status?: string };
		return body.status ?? "pending";
	} catch {
		return "pending";
	}
}

/** Best-effort cancel of a triggered snapshot we're abandoning, so it stops
 *  counting against BrightData's per-dataset running-jobs cap. Cancellation is
 *  cleanup, not part of the run's success path, so errors are swallowed. */
async function cancelSnapshot(client: bdclient, snapshotId: string): Promise<void> {
	try {
		await client.scrape.snapshot.cancel(snapshotId);
	} catch {
		console.warn(`BrightData: failed to cancel snapshot ${snapshotId}`);
	}
}
