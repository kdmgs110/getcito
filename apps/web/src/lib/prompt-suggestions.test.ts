import { MAX_PROMPTS } from "@workspace/lib/constants";
import { describe, expect, it } from "vitest";
import { newPromptEntry } from "@/components/prompts-list-editor";
import { mergePromptSuggestions } from "./prompt-suggestions";

describe("mergePromptSuggestions", () => {
	it("preserves original identities and adds translations with fresh identities", () => {
		const original = newPromptEntry({ id: "saved", value: "Best Rails jobs?" });
		const suggestion = newPromptEntry({ id: "must-not-reuse", value: "Rails案件のおすすめは？", tags: ["jobs"] });
		const result = mergePromptSuggestions([original], [suggestion]);
		expect(result[0]).toBe(original);
		expect(result[1]).toMatchObject({ value: suggestion.value, tags: ["jobs"], enabled: true });
		expect(result[1]).not.toHaveProperty("id");
		expect(result[1]._key).not.toBe(suggestion._key);
	});
	it("skips disabled, blank and duplicate suggestions without mutating the old list", () => {
		const original = [newPromptEntry({ value: "Existing" })];
		const result = mergePromptSuggestions(original, [
			newPromptEntry({ value: " existing " }),
			newPromptEntry({ value: "", enabled: true }),
			newPromptEntry({ value: "Hidden", enabled: false }),
			newPromptEntry({ value: "New" }),
			newPromptEntry({ value: "NEW" }),
		]);
		expect(result.map((p) => p.value)).toEqual(["Existing", "New"]);
		expect(original).toHaveLength(1);
	});
	it("respects capacity without dropping existing prompts or history identities", () => {
		const originals = Array.from({ length: MAX_PROMPTS - 1 }, (_, i) =>
			newPromptEntry({ id: `saved-${i}`, value: `Question ${i}` }),
		);
		const result = mergePromptSuggestions(originals, [
			newPromptEntry({ value: "First" }),
			newPromptEntry({ value: "Second" }),
		]);
		expect(result).toHaveLength(MAX_PROMPTS);
		expect(result.at(-1)?.value).toBe("First");
		expect(result.slice(0, -1)).toEqual(originals);
	});
});
