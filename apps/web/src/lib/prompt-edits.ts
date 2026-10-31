import { z } from "zod";

export const promptEditsSchema = z
	.object({
		brandId: z.string().min(1),
		prompts: z.array(
			z.object({
				id: z.string().uuid().optional(),
				value: z.string().trim().min(1),
				enabled: z.boolean().default(true),
				tags: z.array(z.string()).optional(),
			}),
		),
		// Explicit intent: omitted prompts may have been added in another tab.
		deletedPromptIds: z.array(z.string().uuid()).default([]),
	})
	.superRefine((data, ctx) => {
		const updatedIds = data.prompts.flatMap((prompt) => (prompt.id ? [prompt.id] : []));
		const ids = [...updatedIds, ...data.deletedPromptIds];
		if (new Set(ids).size !== ids.length) {
			ctx.addIssue({ code: "custom", message: "Conflicting prompt IDs" });
		}
	});

export type PromptEdits = z.infer<typeof promptEditsSchema>;

type DraftPrompt = { id?: string; value: string; enabled: boolean; tags?: string[] };

export function buildPromptEdits(brandId: string, initial: { id: string }[], drafts: DraftPrompt[]): PromptEdits {
	const currentIds = new Set(drafts.map((prompt) => prompt.id));
	return promptEditsSchema.parse({
		brandId,
		// Empty new drafts are harmless; empty persisted rows must not become deletions.
		prompts: drafts
			.filter((prompt) => prompt.id || prompt.value.trim())
			.map(({ id, value, enabled, tags }) => ({
				...(id ? { id } : {}),
				value: value.trim(),
				enabled,
				tags,
			})),
		deletedPromptIds: initial.filter((prompt) => !currentIds.has(prompt.id)).map((prompt) => prompt.id),
	});
}
