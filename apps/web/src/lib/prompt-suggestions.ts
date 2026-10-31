import { MAX_PROMPTS } from "@workspace/lib/constants";
import { type EditablePrompt, newPromptEntry } from "@/components/prompts-list-editor";

export function mergePromptSuggestions(existing: EditablePrompt[], suggestions: EditablePrompt[]) {
	const seen = new Set(existing.map((prompt) => prompt.value.trim().toLocaleLowerCase()));
	const added: EditablePrompt[] = [];
	for (const prompt of suggestions) {
		const value = prompt.value.trim();
		if (
			!prompt.enabled ||
			!value ||
			seen.has(value.toLocaleLowerCase()) ||
			existing.length + added.length >= MAX_PROMPTS
		)
			continue;
		seen.add(value.toLocaleLowerCase());
		added.push(newPromptEntry({ value, tags: prompt.tags, enabled: true }));
	}
	return [...existing, ...added];
}
