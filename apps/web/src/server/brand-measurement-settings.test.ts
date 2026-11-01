import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseScrapeTargets } from "@workspace/lib/providers";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn(), boss: vi.fn(), send: vi.fn() }));
vi.mock("@workspace/lib/db/db", () => ({ db: { $client: { connect: mocks.connect } } }));
vi.mock("@/lib/boss-client", () => ({ getBoss: mocks.boss }));
import { saveBrandMeasurementTargets } from "./brand-measurement-settings";

const web = "chatgpt:brightdata:online";
const api = "chatgpt:openai-api:gpt-5:online";
const configs = parseScrapeTargets(`${api},${web}`);
let brand: { enabled: boolean; enabled_models: string[] | null; enabled_targets: string[] | null } | undefined;
let events: string[];
beforeEach(() => {
	brand = { enabled: true, enabled_models: null, enabled_targets: [api] };
	events = [];
	mocks.release.mockReset();
	mocks.query.mockReset().mockImplementation(async (sql: string) => {
		events.push(sql);
		if (sql.startsWith("SELECT enabled,")) return { rows: brand ? [brand] : [] };
		if (sql.startsWith("SELECT id FROM prompts")) return { rows: [{ id: "p1" }, { id: "p2" }] };
		return { rows: [] };
	});
	mocks.connect.mockReset().mockResolvedValue({ query: mocks.query, release: mocks.release });
	mocks.boss.mockReset().mockResolvedValue({ send: mocks.send });
	mocks.send.mockReset().mockImplementation(async (_name, _data, options) => {
		await options.db.executeSql("INSERT queue job", []);
		return "job";
	});
});
const save = (targetKeys = [api, web]) => saveBrandMeasurementTargets({ brandId: "brand", targetKeys }, configs);

describe("measurement settings and immediate jobs", () => {
	it("queues only added exact targets for enabled prompts, in the same transaction as settings", async () => {
		const result = await save();
		expect(result).toEqual({
			targetKeys: [api, web],
			addedTargetKeys: [web],
			queuedPrompts: 2,
			measurementBatchId: expect.any(String),
		});
		expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["brand"]);
		expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("brand_id=$1 AND enabled=true"), ["brand"]);
		expect(mocks.send).toHaveBeenCalledTimes(2);
		for (const promptId of ["p1", "p2"]) {
			expect(mocks.send).toHaveBeenCalledWith(
				"process-prompt",
				{
					promptId,
					singleRun: true,
					settingsChange: true,
					targetKeys: [web],
					measurementBatchId: result.measurementBatchId,
				},
				expect.objectContaining({ priority: 100, retryLimit: 0, db: expect.any(Object) }),
			);
		}
		expect(events[0]).toBe("BEGIN");
		expect(events.at(-1)).toBe("COMMIT");
		expect(events.filter((event) => event === "INSERT queue job")).toHaveLength(2);
		expect(mocks.release).toHaveBeenCalledOnce();
	});
	it("does not charge for repeated saves, reordered targets or duplicate selections", async () => {
		if (brand) brand.enabled_targets = [web, api];
		const result = await save([web, api, web]);
		expect(result.queuedPrompts).toBe(0);
		expect(result.addedTargetKeys).toEqual([]);
		expect(mocks.boss).not.toHaveBeenCalled();
	});
	it("saves removing all targets without scheduling anything", async () => {
		expect((await save([])).queuedPrompts).toBe(0);
		expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE brands"), [[], "brand"]);
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("does not schedule a paused brand", async () => {
		if (brand) brand.enabled = false;
		expect((await save()).queuedPrompts).toBe(0);
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("does not schedule when there are no enabled prompts", async () => {
		mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT enabled,") ? [brand] : [] }));
		expect((await save()).queuedPrompts).toBe(0);
		expect(mocks.boss).not.toHaveBeenCalled();
	});
	it("respects inherited and legacy model selection when determining newly enabled targets", async () => {
		if (brand) brand.enabled_targets = null;
		expect((await save()).queuedPrompts).toBe(0);
		if (brand) brand.enabled_models = [];
		expect((await save([web])).addedTargetKeys).toEqual([web]);
	});
	it("allows replacing an obsolete explicit deployment target", async () => {
		if (brand) brand.enabled_targets = ["removed:provider:online"];
		expect((await save([web])).addedTargetKeys).toEqual([web]);
	});
	it("rolls back the settings and all jobs if any enqueue fails", async () => {
		mocks.send.mockResolvedValueOnce("first-job").mockRejectedValueOnce(new Error("Queue unavailable"));
		await expect(save()).rejects.toThrow("Queue unavailable");
		expect(events.at(-1)).toBe("ROLLBACK");
		expect(events).not.toContain("COMMIT");
		expect(mocks.release).toHaveBeenCalledOnce();
	});
	it("does not report success when pg-boss returns no job ID", async () => {
		mocks.send.mockResolvedValue(null);
		await expect(save()).rejects.toThrow("not queued");
		expect(events.at(-1)).toBe("ROLLBACK");
	});
	it("rolls back when the queue cannot initialize", async () => {
		mocks.boss.mockRejectedValue(new Error("Queue initialization failed"));
		await expect(save()).rejects.toThrow("Queue initialization failed");
		expect(events.at(-1)).toBe("ROLLBACK");
	});
	it("rejects missing brands and unavailable targets without leaving changes", async () => {
		brand = undefined;
		await expect(save()).rejects.toThrow("Brand not found");
		expect(events.at(-1)).toBe("ROLLBACK");
		mocks.connect.mockClear();
		await expect(save(["unknown:target:online"])).rejects.toThrow("enabledTargets");
		expect(mocks.connect).not.toHaveBeenCalled();
	});
});
