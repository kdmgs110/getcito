/**
 * Billable-call accounting for upstream providers.
 *
 * Most adapters bill one unit per run/research attempt. DataForSEO's queued
 * scraper is different: only an accepted task POST is billable, while polling
 * and restarting a saved task use free GETs. Its callback records the accepted
 * POST immediately; a resumed run therefore adds no provider_calls row.
 *
 * Recording is best-effort by design: a logging failure must never take down
 * the run that was being logged, so `recordProviderCall` swallows its own
 * errors after warning.
 */
import { db } from "../db/db";
import { providerCalls } from "../db/schema";

export type ProviderCallKind = "run" | "research";

export interface ProviderCallRecord {
	provider: string;
	model: string;
	kind: ProviderCallKind;
	brandId?: string | null;
	/** Set for tracked prompt runs; null for reports and onboarding research. */
	promptId?: string | null;
	success: boolean;
	errorMessage?: string | null;
	durationMs?: number;
}

/** Error text is only ever read by a human in the admin table. */
const MAX_ERROR_CHARS = 500;

export async function recordProviderCall(record: ProviderCallRecord): Promise<void> {
	try {
		await db.insert(providerCalls).values({
			provider: record.provider,
			model: record.model,
			kind: record.kind,
			brandId: record.brandId ?? null,
			promptId: record.promptId ?? null,
			success: record.success,
			errorMessage: record.errorMessage?.slice(0, MAX_ERROR_CHARS) ?? null,
			durationMs: record.durationMs,
		});
	} catch (err) {
		console.warn("[provider-usage] failed to record call:", err);
	}
}

/**
 * Record normal run attempts, or only confirmed POSTs in callback mode.
 *
 * The original error is always rethrown — the counter is an observer, never a
 * gate on the work it observes.
 */
export async function withProviderCallTracking<T>(
	meta: Omit<ProviderCallRecord, "success" | "errorMessage" | "durationMs">,
	fn: (onBillableCall: () => Promise<void>) => Promise<T>,
	options: { billableOnCallback?: boolean } = {},
): Promise<T> {
	const startedAt = Date.now();
	let confirmation: Promise<void> | undefined;
	const confirmed = async () => {
		if (!options.billableOnCallback) return;
		// Persist at POST acceptance, before a potentially long/free polling phase.
		// A restart during polling then has no reason to add a second usage row.
		confirmation ??= recordProviderCall({ ...meta, success: true, durationMs: Date.now() - startedAt });
		await confirmation;
	};
	try {
		const result = await fn(confirmed);
		if (options.billableOnCallback) await confirmation;
		else await recordProviderCall({ ...meta, success: true, durationMs: Date.now() - startedAt });
		return result;
	} catch (err) {
		if (options.billableOnCallback) await confirmation;
		else
			await recordProviderCall({
				...meta,
				success: false,
				errorMessage: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - startedAt,
			});
		throw err;
	}
}
