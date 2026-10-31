import { citations, promptRuns, prompts } from "@workspace/lib/db/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptEdits } from "@/lib/prompt-edits";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@workspace/lib/db/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/job-scheduler", () => ({
	removeBrandJobSchedulers: mocks.cancel,
	createMultiplePromptJobSchedulers: mocks.schedule,
}));

import { savePromptEdits } from "./prompt-mutations";

const id = "00000000-0000-4000-8000-000000000001";
const pausedId = "00000000-0000-4000-8000-000000000002";
const concurrentId = "00000000-0000-4000-8000-000000000003";
const insertedId = "00000000-0000-4000-8000-000000000004";
const dialect = new PgDialect();
let events: string[];
let deletedTables: unknown[];
let mutations: { type: string; values?: unknown; params: unknown[] }[];
let failDelete: boolean;
let failCommit: boolean;
const tx = {
	query: { brands: { findFirst: vi.fn() }, prompts: { findMany: vi.fn() } },
	select: () => ({
		from: () => ({
			where: () => ({
				orderBy: () => ({
					for: (lock: string) => {
						events.push(`lock:${lock}`);
						return Promise.resolve([
							{ id, enabled: true },
							{ id: pausedId, enabled: false },
							{ id: concurrentId, enabled: true },
						]);
					},
				}),
			}),
		}),
	}),
	delete: (table: unknown) => ({
		where: async (condition: SQL) => {
			deletedTables.push(table);
			mutations.push({ type: "delete", params: dialect.sqlToQuery(condition).params });
			if (failDelete && table === prompts) throw new Error("delete failed");
		},
	}),
	update: () => ({
		set: (values: unknown) => ({
			where: async (condition: SQL) => {
				mutations.push({ type: "update", values, params: dialect.sqlToQuery(condition).params });
			},
		}),
	}),
	insert: () => ({
		values: (values: unknown) => ({
			returning: async () => {
				mutations.push({ type: "insert", values, params: [] });
				return [{ id: insertedId }];
			},
		}),
	}),
};
beforeEach(() => {
	events = [];
	deletedTables = [];
	mutations = [];
	failDelete = false;
	failCommit = false;
	tx.query.brands.findFirst.mockResolvedValue({ id: "brand", name: "Brand", website: "https://example.com" });
	tx.query.prompts.findMany.mockResolvedValue([{ id: pausedId, enabled: false }, { id: concurrentId }]);
	mocks.cancel.mockReset().mockImplementation(async () => {
		events.push("cancel");
	});
	mocks.schedule.mockReset().mockImplementation(async () => {
		events.push("schedule");
		return [];
	});
	mocks.transaction.mockReset().mockImplementation(async (run: (transaction: typeof tx) => Promise<unknown>) => {
		const result = await run(tx);
		if (failCommit) throw new Error("commit failed");
		events.push("commit");
		return result;
	});
});
const edits = (): PromptEdits => ({
	brandId: "brand",
	deletedPromptIds: [id],
	prompts: [{ id: pausedId, value: "paused", enabled: false }],
});
describe("savePromptEdits", () => {
	it("locks prompts, deletes children first, retains paused and concurrent rows and cancels jobs after commit", async () => {
		await expect(savePromptEdits(edits())).resolves.toEqual([{ id: pausedId, enabled: false }, { id: concurrentId }]);
		expect(events).toEqual(["lock:update", "commit", "cancel"]);
		expect(deletedTables).toEqual([citations, promptRuns, prompts]);
		for (const deletion of mutations.filter((entry) => entry.type === "delete"))
			expect(deletion.params).toEqual(["brand", id]);
		expect(mutations.find((entry) => entry.type === "update")).toMatchObject({
			values: { enabled: false },
			params: [pausedId, "brand"],
		});
		expect(mutations.some((entry) => entry.params.includes(concurrentId))).toBe(false);
		expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith([id]);
		expect(mocks.schedule).not.toHaveBeenCalled();
	});
	it.each(["deleted", "updated"])("rejects foreign or removed %s IDs before writes", async (kind) => {
		const input = edits();
		if (kind === "deleted") input.deletedPromptIds = [insertedId];
		else input.prompts[0].id = insertedId;
		await expect(savePromptEdits(input)).rejects.toThrow("Prompts changed");
		expect(mutations).toEqual([]);
		expect(mocks.cancel).not.toHaveBeenCalled();
		expect(mocks.schedule).not.toHaveBeenCalled();
	});
	it.each(["delete", "commit"])("leaves job scheduling intact after a %s failure", async (failure) => {
		failDelete = failure === "delete";
		failCommit = failure === "commit";
		await expect(savePromptEdits(edits())).rejects.toThrow("failed");
		expect(mocks.cancel).not.toHaveBeenCalled();
		expect(mocks.schedule).not.toHaveBeenCalled();
	});
	it("does not delete omitted rows without explicit IDs", async () => {
		await savePromptEdits({ brandId: "brand", deletedPromptIds: [], prompts: [] });
		expect(mutations).toEqual([]);
		expect(mocks.cancel).not.toHaveBeenCalled();
	});
	it.each([true, false])("schedules new prompts only if enabled=%s", async (enabled) => {
		await savePromptEdits({ brandId: "brand", deletedPromptIds: [], prompts: [{ value: "new", enabled }] });
		if (enabled) expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith([insertedId]);
		else expect(mocks.schedule).not.toHaveBeenCalled();
		expect(events).toEqual(enabled ? ["lock:update", "commit", "schedule"] : ["lock:update", "commit"]);
	});
	it("starts a paused prompt after it is enabled and the save commits", async () => {
		await savePromptEdits({
			brandId: "brand",
			deletedPromptIds: [],
			prompts: [{ id: pausedId, value: "enabled", enabled: true }],
		});
		expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith([pausedId]);
		expect(events).toEqual(["lock:update", "commit", "schedule"]);
	});
	it("does not restart an unchanged enabled prompt", async () => {
		await savePromptEdits({
			brandId: "brand",
			deletedPromptIds: [],
			prompts: [{ id, value: "edited", enabled: true }],
		});
		expect(mocks.schedule).not.toHaveBeenCalled();
	});
	it("does not start re-enabled measurement when the commit fails", async () => {
		failCommit = true;
		await expect(
			savePromptEdits({
				brandId: "brand",
				deletedPromptIds: [],
				prompts: [{ id: pausedId, value: "enabled", enabled: true }],
			}),
		).rejects.toThrow("commit failed");
		expect(mocks.schedule).not.toHaveBeenCalled();
	});

	it("rejects a missing brand without writes", async () => {
		tx.query.brands.findFirst.mockResolvedValue(undefined);
		await expect(savePromptEdits(edits())).rejects.toThrow("Brand not found");
		expect(events).toEqual([]);
		expect(mutations).toEqual([]);
	});
});
