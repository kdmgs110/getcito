// Server-only: keep database imports out of client-side server-function exports.
import { db } from "@workspace/lib/db/db";
import { brands, citations, promptRuns, prompts } from "@workspace/lib/db/schema";
import { computeSystemTags } from "@workspace/lib/tag-utils";
import { and, eq, inArray } from "drizzle-orm";
import { createMultiplePromptJobSchedulers, removeBrandJobSchedulers } from "@/lib/job-scheduler";
import type { PromptEdits } from "@/lib/prompt-edits";

/** Call only after authenticating and checking organization membership. */
export async function savePromptEdits(data: PromptEdits) {
	const result = await db.transaction(async (tx) => {
		const brand = await tx.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
		if (!brand) throw new Error("Brand not found");

		// Serialize edits and block new FK-backed runs during the child-first delete.
		const existing = await tx
			.select({ id: prompts.id, enabled: prompts.enabled })
			.from(prompts)
			.where(eq(prompts.brandId, data.brandId))
			.orderBy(prompts.id)
			.for("update");
		const existingById = new Map(existing.map((prompt) => [prompt.id, prompt]));
		const requestedIds = [
			...data.prompts.flatMap((prompt) => (prompt.id ? [prompt.id] : [])),
			...data.deletedPromptIds,
		];
		if (requestedIds.some((id) => !existingById.has(id))) {
			throw new Error("Prompts changed. Reload the page and try again.");
		}

		if (data.deletedPromptIds.length) {
			await tx
				.delete(citations)
				.where(and(eq(citations.brandId, data.brandId), inArray(citations.promptId, data.deletedPromptIds)));
			await tx
				.delete(promptRuns)
				.where(and(eq(promptRuns.brandId, data.brandId), inArray(promptRuns.promptId, data.deletedPromptIds)));
			await tx
				.delete(prompts)
				.where(and(eq(prompts.brandId, data.brandId), inArray(prompts.id, data.deletedPromptIds)));
		}

		const scheduledIds: string[] = [];
		for (const prompt of data.prompts) {
			const values = {
				value: prompt.value,
				enabled: prompt.enabled,
				tags: prompt.tags || [],
				systemTags: computeSystemTags(prompt.value, brand.name, brand.website),
			};
			if (prompt.id) {
				await tx
					.update(prompts)
					.set(values)
					.where(and(eq(prompts.id, prompt.id), eq(prompts.brandId, data.brandId)));
				// Initially paused prompts have no queued job; enabling them must start measurement.
				if (prompt.enabled && existingById.get(prompt.id)?.enabled === false) scheduledIds.push(prompt.id);
			} else {
				const [inserted] = await tx
					.insert(prompts)
					.values({ ...values, brandId: data.brandId })
					.returning({ id: prompts.id });
				if (inserted && prompt.enabled) scheduledIds.push(inserted.id);
			}
		}
		const saved = await tx.query.prompts.findMany({ where: eq(prompts.brandId, data.brandId) });
		return { saved, scheduledIds };
	});

	// Only cancel jobs after a successful commit; failed saves leave scheduling intact.
	if (data.deletedPromptIds.length) await removeBrandJobSchedulers(data.deletedPromptIds);
	if (result.scheduledIds.length) {
		createMultiplePromptJobSchedulers(result.scheduledIds).catch((error) =>
			console.error("Failed to create job schedulers for enabled prompts:", error),
		);
	}
	return result.saved;
}
