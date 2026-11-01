// Server-only: settings and their immediate measurements commit together.
import { randomUUID } from "node:crypto";
import { FIRST_RUN_JOB_PRIORITY, PROCESS_PROMPT_JOB_POLICY } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { measurementTargetKey } from "@workspace/lib/measurement";
import { type ModelConfig, selectTargetsForBrand } from "@workspace/lib/providers";
import { getBoss } from "@/lib/boss-client";

interface StoredBrand {
	enabled: boolean;
	enabled_models: string[] | null;
	enabled_targets: string[] | null;
}

/** Call only after authenticating and checking organization management access. */
export async function saveBrandMeasurementTargets(
	input: { brandId: string; targetKeys: string[] },
	configured: ModelConfig[],
) {
	const targetKeys = [...new Set(selectTargetsForBrand(configured, null, input.targetKeys).map(measurementTargetKey))];
	const client = await db.$client.connect();
	try {
		await client.query("BEGIN");
		// Concurrent saves compare against the last committed settings, so a
		// network retry or double save cannot enqueue the same change twice.
		const { rows } = await client.query<StoredBrand>(
			"SELECT enabled,enabled_models,enabled_targets FROM brands WHERE id=$1 FOR UPDATE",
			[input.brandId],
		);
		const brand = rows[0];
		if (!brand) throw new Error("Brand not found");
		// Obsolete explicit targets must not prevent fixing the brand's settings.
		const previous = new Set(
			brand.enabled_targets ??
				configured
					.filter((config) => brand.enabled_models === null || brand.enabled_models.includes(config.model))
					.map(measurementTargetKey),
		);
		const addedTargetKeys = targetKeys.filter((key) => !previous.has(key));
		await client.query("UPDATE brands SET enabled_targets=$1,updated_at=NOW() WHERE id=$2", [
			targetKeys,
			input.brandId,
		]);

		const enabledPrompts =
			brand.enabled && addedTargetKeys.length
				? (
						await client.query<{ id: string }>(
							"SELECT id FROM prompts WHERE brand_id=$1 AND enabled=true ORDER BY id",
							[input.brandId],
						)
					).rows
				: [];
		const measurementBatchId = enabledPrompts.length ? randomUUID() : null;
		if (measurementBatchId) {
			const boss = await getBoss();
			for (const prompt of enabledPrompts) {
				const jobId = await boss.send(
					"process-prompt",
					{
						promptId: prompt.id,
						singleRun: true,
						settingsChange: true,
						targetKeys: addedTargetKeys,
						measurementBatchId,
					},
					{
						...PROCESS_PROMPT_JOB_POLICY,
						priority: FIRST_RUN_JOB_PRIORITY,
						// pg-boss writes through the same transaction. Jobs cannot be
						// fetched before settings commit, and a send failure rolls back all.
						db: { executeSql: (text, values) => client.query(text, values) },
					},
				);
				if (!jobId) throw new Error("Measurement job was not queued");
			}
		}
		await client.query("COMMIT");
		return { targetKeys, addedTargetKeys, queuedPrompts: enabledPrompts.length, measurementBatchId };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
