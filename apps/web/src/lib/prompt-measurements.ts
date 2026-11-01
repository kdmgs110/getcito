import { WEB_QUERIES_UNAVAILABLE } from "@workspace/lib/constants";
import {
	type MeasurementEvidence,
	type MeasurementSurface,
	measurementSurface,
	measurementTargetLabel,
	safeEvidenceUrl,
} from "@workspace/lib/measurement";
import type { PromptRunRequestContext } from "@workspace/lib/prompt-run-context";

export interface PromptMeasurementTarget {
	key: string;
	model: string;
	provider: string;
	requestedVersion: string | null;
	webSearch: boolean;
	label: string;
	surface: MeasurementSurface;
	configured: boolean;
	legacy?: boolean;
}

export interface PromptMeasurementRecord {
	id: string;
	attemptId: string | null;
	runId: string | null;
	targetKey: string;
	model: string;
	provider: string;
	version: string | null;
	status: "queued" | "running" | "succeeded" | "failed";
	createdAt: string;
	completedAt: string | null;
	requestContext: PromptRunRequestContext | null;
	evidence: MeasurementEvidence;
	queries: string[];
	citations: Array<{ url: string; title: string | null }>;
	rawOutput?: string;
}

export interface PromptMeasurementsResponse {
	targets: PromptMeasurementTarget[];
	records: PromptMeasurementRecord[];
}

export const COMPARISON_SURFACES = ["chatgpt_web", "google_ai_overview"] as const;

export function isComparisonSurface(model: string, provider: string | null | undefined): boolean {
	return COMPARISON_SURFACES.some((surface) => surface === measurementSurface(model, provider));
}

export function legacyMeasurementTarget(model: string, provider: string, version: string, online: boolean) {
	return {
		key: `legacy:${JSON.stringify([model, provider, version, online])}`,
		model,
		provider,
		requestedVersion: null,
		webSearch: online,
		label: measurementTargetLabel(model, provider),
		surface: measurementSurface(model, provider),
		configured: false,
		legacy: true,
	} satisfies PromptMeasurementTarget;
}

/** Empty or sentinel-only arrays do not establish that the engine did not search. */
export function observedQueries(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	return [
		...new Set(
			values
				.filter((value): value is string => typeof value === "string")
				.map((value) => value.trim())
				.filter((value) => value && value.toLowerCase() !== WEB_QUERIES_UNAVAILABLE),
		),
	];
}

export function safeMeasurementEvidence(evidence: MeasurementEvidence): MeasurementEvidence {
	return {
		...evidence,
		queryEvidence: (evidence.queryEvidence ?? []).map((entry) => ({
			...entry,
			urls: entry.urls.flatMap((item) => {
				const url = safeEvidenceUrl(item.url);
				return url ? [{ ...item, url }] : [];
			}),
		})),
	};
}

export function safeMeasurementCitations(values: Array<{ url: string; title: string | null }>) {
	const seen = new Set<string>();
	return values.flatMap((item) => {
		const url = safeEvidenceUrl(item.url);
		if (!url || seen.has(url)) return [];
		seen.add(url);
		return [{ url, title: item.title }];
	});
}

export function measurementEvidenceFallback(
	answerText: string,
	queries: string[],
	webSearch: boolean,
): MeasurementEvidence {
	return {
		version: 1,
		answerText,
		// Legacy "No Google AI mode invoked" was also used for malformed AIO records.
		// It cannot safely distinguish no Overview from a failed extraction.
		answerStatus: !answerText.trim() || /^No Google AI mode invoked\.?$/i.test(answerText.trim()) ? "unknown" : "shown",
		queryStatus: !webSearch ? "not_used" : queries.length ? "observed" : "unknown",
		queryEvidence: [],
	};
}
