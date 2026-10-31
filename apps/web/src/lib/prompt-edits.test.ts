import { describe, expect, it } from "vitest";
import { buildPromptEdits, promptEditsSchema } from "./prompt-edits";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
describe("prompt edit intent", () => {
	it("marks only removed saved rows for deletion, retains paused rows and ignores empty new drafts", () => {
		expect(
			buildPromptEdits(
				"brand",
				[{ id }, { id: other }],
				[
					{ id: other, value: " paused ", enabled: false, tags: ["tag"] },
					{ value: "  ", enabled: true },
				],
			),
		).toEqual({
			brandId: "brand",
			deletedPromptIds: [id],
			prompts: [{ id: other, value: "paused", enabled: false, tags: ["tag"] }],
		});
	});
	it("rejects empty existing rows without interpreting them as deletion", () => {
		expect(() => buildPromptEdits("brand", [{ id }], [{ id, value: "  ", enabled: true }])).toThrow();
	});
	it("does not infer deletions for clients omitting the new field", () => {
		expect(promptEditsSchema.parse({ brandId: "brand", prompts: [] }).deletedPromptIds).toEqual([]);
	});
	it.each([
		{ prompts: [{ id, value: "keep" }], deletedPromptIds: [id] },
		{
			prompts: [
				{ id, value: "a" },
				{ id, value: "b" },
			],
			deletedPromptIds: [],
		},
		{ prompts: [], deletedPromptIds: [id, id] },
	])("rejects overlapping and repeated identities", (edits) => {
		expect(() => promptEditsSchema.parse({ brandId: "brand", ...edits })).toThrow("Conflicting prompt IDs");
	});
	it("rejects invalid prompt identifiers", () => {
		expect(() => promptEditsSchema.parse({ brandId: "brand", prompts: [], deletedPromptIds: ["bad-id"] })).toThrow();
	});
});
