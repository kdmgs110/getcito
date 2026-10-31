import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), save: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (value: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgAccess: mocks.access }));
vi.mock("@/server/prompt-mutations", () => ({ savePromptEdits: mocks.save }));
vi.mock("@workspace/lib/db/db", () => ({ db: {} }));
vi.mock("@/lib/postgres-read", () => ({}));
vi.mock("@/lib/domain-categories.server", () => ({ classifyUrl: vi.fn() }));

import { updatePromptsFn } from "./prompts";

const data = { brandId: "brand", prompts: [], deletedPromptIds: ["00000000-0000-4000-8000-000000000001"] };
beforeEach(() => {
	mocks.auth.mockReset().mockResolvedValue({ user: { id: "member" } });
	mocks.access.mockReset().mockResolvedValue(undefined);
	mocks.save.mockReset().mockResolvedValue([]);
});
describe("prompt mutation authorization", () => {
	it("rejects unauthenticated deletion before checking access or mutating", async () => {
		mocks.auth.mockRejectedValue(new Error("Unauthorized"));
		await expect(updatePromptsFn({ data })).rejects.toThrow("Unauthorized");
		expect(mocks.access).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("rejects a different brand's organization before mutating", async () => {
		mocks.access.mockRejectedValue(new Error("Forbidden"));
		await expect(updatePromptsFn({ data })).rejects.toThrow("Forbidden");
		expect(mocks.access).toHaveBeenCalledExactlyOnceWith("member", "brand");
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("passes only validated edits after organization authorization succeeds", async () => {
		await expect(updatePromptsFn({ data })).resolves.toEqual([]);
		expect(mocks.save).toHaveBeenCalledExactlyOnceWith(data);
		expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
	});
	it("rejects invalid deletion IDs without writing", async () => {
		expect(() => updatePromptsFn({ data: { ...data, deletedPromptIds: ["bad-id"] } })).toThrow();
		expect(mocks.save).not.toHaveBeenCalled();
	});
});
