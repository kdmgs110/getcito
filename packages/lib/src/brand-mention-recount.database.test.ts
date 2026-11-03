import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testUrl = process.env.DATAFORSEO_TEST_DATABASE_URL;
const schema = `mention_test_${randomUUID().replaceAll("-", "")}`;
const proxy = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock("./db/db", () => ({ db: { $client: proxy } }));

import {
	type EnqueueMentionRecount,
	getMentionRecountStatus,
	processMentionRecountBatch,
	registerMentionBrand,
	retryMentionRecount,
	saveMentionCompetitors,
} from "./brand-mention-recount";

let pool: Pool;
function requiredId(status: { id?: string }): string {
	if (!status.id) throw new Error("Expected a recount generation");
	return status.id;
}
const own = "own";
const foreign = "foreign";
const prompt = randomUUID();
let runA: string;
let runB: string;
const enqueue: EnqueueMentionRecount = async (data, client) => {
	await client.query("INSERT INTO queued VALUES($1,$2)", [data.id, data.brandId]);
};

describe.skipIf(!testUrl)("mention registration and atomic recount (PostgreSQL)", () => {
	beforeAll(async () => {
		const url = new URL(testUrl ?? "");
		if (!/^\/(codex_|test_)/.test(url.pathname) && url.pathname !== "/getcito_test")
			throw new Error("Use an isolated test database");
		const setup = new Pool({ connectionString: url.toString() });
		await setup.query(`CREATE SCHEMA "${schema}"`);
		await setup.end();
		pool = new Pool({ connectionString: url.toString(), options: `-c search_path=${schema}` });
		proxy.connect.mockImplementation(() => pool.connect());
		proxy.query.mockImplementation((...args) => pool.query(...args));
		await pool.query(`CREATE TABLE brands(id text PRIMARY KEY,name text,website text,aliases text[] DEFAULT '{}',additional_domains text[] DEFAULT '{}',updated_at timestamptz DEFAULT now());
		CREATE TABLE competitors(id uuid PRIMARY KEY,brand_id text REFERENCES brands(id),name text,domains text[] DEFAULT '{}',aliases text[] DEFAULT '{}',updated_at timestamptz DEFAULT now());
		CREATE TABLE prompt_runs(id uuid PRIMARY KEY,brand_id text REFERENCES brands(id),prompt_id uuid,model text,provider text,raw_output jsonb,mention_analysis jsonb,brand_mentioned boolean,competitors_mentioned text[]);
		CREATE TABLE measurement_attempts(id uuid PRIMARY KEY,prompt_run_id uuid,brand_id text,prompt_id uuid,model text,status text,evidence jsonb,completed_at timestamptz DEFAULT now());
		CREATE TABLE brand_mention_recounts(brand_id text PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,id uuid,status text,processed int,total int,catalog_hash text,error text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz);
		CREATE TABLE brand_mention_recount_rows(run_id uuid PRIMARY KEY REFERENCES prompt_runs(id) ON DELETE CASCADE,brand_id text REFERENCES brands(id) ON DELETE CASCADE,job_id uuid,analysis jsonb,brand_mentioned boolean,competitors_mentioned text[]);
		CREATE TABLE queued(id uuid,brand_id text);`);
	});
	afterAll(async () => {
		if (pool) {
			await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
			await pool.end();
		}
	});
	beforeEach(async () => {
		await pool.query(
			"TRUNCATE brands,competitors,prompt_runs,measurement_attempts,brand_mention_recounts,brand_mention_recount_rows,queued CASCADE",
		);
		await pool.query(
			"INSERT INTO brands(id,name,website) VALUES($1,'Own Brand','https://own.example'),($2,'Foreign Brand','https://foreign.example')",
			[own, foreign],
		);
		runA = randomUUID();
		runB = randomUUID();
		for (const id of [runA, runB])
			await pool.query("INSERT INTO prompt_runs VALUES($1,$2,$3,'chatgpt','dataforseo-scraper',$4,NULL,false,'{}')", [
				id,
				own,
				prompt,
				{ tasks: [{ result: [{ markdown: "1. New Agent\n2. Own Brand" }] }] },
			]);
	});
	it("stages in bounded batches and changes flags only at atomic publication", async () => {
		const registered = await registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, enqueue);
		expect(await processMentionRecountBatch(own, requiredId(registered.recount), 1)).toBe("more");
		expect((await pool.query("SELECT brand_mentioned,competitors_mentioned FROM prompt_runs")).rows).toEqual([
			{ brand_mentioned: false, competitors_mentioned: [] },
			{ brand_mentioned: false, competitors_mentioned: [] },
		]);
		expect((await getMentionRecountStatus(own)).processed).toBe(1);
		await processMentionRecountBatch(own, requiredId(registered.recount), 1);
		expect(await processMentionRecountBatch(own, requiredId(registered.recount), 1)).toBe("done");
		const runs = (await pool.query("SELECT brand_mentioned,competitors_mentioned,mention_analysis FROM prompt_runs"))
			.rows;
		expect(runs.every((r) => r.brand_mentioned && r.competitors_mentioned[0] === "New Agent")).toBe(true);
		expect(runs[0].mention_analysis.mentions.map((m: { rank: number }) => m.rank)).toEqual([1, 2]);
		expect((await getMentionRecountStatus(own)).status).toBe("completed");
	});
	it("serializes duplicate name-only registrations and keeps one competitor and queued generation", async () => {
		const results = await Promise.all([
			registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, enqueue),
			registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, enqueue),
		]);
		expect(results[0].entityId).toBe(results[1].entityId);
		expect((await pool.query("SELECT count(*) FROM competitors")).rows[0].count).toBe("1");
		expect((await pool.query("SELECT count(*) FROM queued")).rows[0].count).toBe("1");
	});
	it("rolls back definitions and job state if queue insertion fails", async () => {
		await expect(
			registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, async () => {
				throw new Error("Queue unavailable");
			}),
		).rejects.toThrow("Queue unavailable");
		expect((await pool.query("SELECT count(*) FROM competitors")).rows[0].count).toBe("0");
		expect((await getMentionRecountStatus(own)).status).toBe("idle");
	});
	it("rejects foreign source answers, foreign competitor IDs and alias collisions", async () => {
		const existing = await registerMentionBrand(
			{ brandId: own, name: "New Agent", aliases: ["Alias Agent"], target: "new" },
			enqueue,
		);
		await expect(
			registerMentionBrand({ brandId: foreign, name: "New Agent", target: "new", sourceRunId: runA }, enqueue),
		).rejects.toThrow("回答");
		await expect(
			registerMentionBrand(
				{ brandId: foreign, name: "New Agent", target: "competitor", competitorId: existing.entityId },
				enqueue,
			),
		).rejects.toThrow("競合");
		await expect(
			registerMentionBrand({ brandId: own, name: "Another Agent", aliases: ["Alias Agent"], target: "new" }, enqueue),
		).rejects.toThrow("別名");
	});
	it("restarts staging after definitions change and catches answers arriving mid-recount", async () => {
		const first = await registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, enqueue);
		await processMentionRecountBatch(own, requiredId(first.recount), 1);
		const second = await registerMentionBrand(
			{ brandId: own, name: "Agent Alias", target: "competitor", competitorId: first.entityId },
			enqueue,
		);
		expect(await processMentionRecountBatch(own, requiredId(first.recount))).toBe("superseded");
		await pool.query("INSERT INTO prompt_runs VALUES($1,$2,$3,'chatgpt','dataforseo-scraper',$4,NULL,false,'{}')", [
			randomUUID(),
			own,
			prompt,
			{ tasks: [{ result: [{ markdown: "Agent Alias" }] }] },
		]);
		while ((await processMentionRecountBatch(own, requiredId(second.recount), 1)) === "more") {
			/* finish */
		}
		expect((await getMentionRecountStatus(own)).total).toBe(3);
		expect(
			(await pool.query("SELECT count(*) FROM prompt_runs WHERE competitors_mentioned=ARRAY['New Agent']")).rows[0]
				.count,
		).toBe("3");
	});
	it("excludes failed/non-answer attempts and honors successful evidence over raw output", async () => {
		await pool.query(
			"INSERT INTO measurement_attempts VALUES($1,$2,$3,$4,'chatgpt','failed',$5,now()),($6,$7,$3,$4,'chatgpt','succeeded',$8,now())",
			[
				randomUUID(),
				runA,
				own,
				prompt,
				{ answerStatus: "shown", answerText: "Own Brand" },
				randomUUID(),
				runB,
				{ answerStatus: "shown", answerText: "Own Brand" },
			],
		);
		const result = await registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, enqueue);
		while ((await processMentionRecountBatch(own, requiredId(result.recount))) === "more") {
			/* finish */
		}
		expect((await getMentionRecountStatus(own)).total).toBe(1);
		const rows = await pool.query("SELECT id,mention_analysis,competitors_mentioned FROM prompt_runs ORDER BY id");
		expect(rows.rows.find((r) => r.id === runA).mention_analysis).toBeNull();
		expect(rows.rows.find((r) => r.id === runB).competitors_mentioned).toEqual([]);
	});
	it("keeps IDs and name-only competitors on settings saves and resumes failed stages", async () => {
		const first = await registerMentionBrand({ brandId: own, name: "New Agent", target: "new" }, enqueue);
		await saveMentionCompetitors(
			own,
			[{ id: first.entityId, name: "Renamed Agent", aliases: ["New Agent"], domains: [] }],
			enqueue,
		);
		expect((await pool.query("SELECT id,name,domains FROM competitors")).rows).toEqual([
			{ id: first.entityId, name: "Renamed Agent", domains: [] },
		]);
		const status = await getMentionRecountStatus(own);
		await processMentionRecountBatch(own, requiredId(status), 1);
		await pool.query("UPDATE brand_mention_recounts SET status='failed'");
		const retry = await retryMentionRecount(own, enqueue);
		expect(retry.id).toBe(status.id);
		expect(retry.processed).toBe(1);
		while ((await processMentionRecountBatch(own, requiredId(retry), 1)) === "more") {
			/* finish */
		}
		expect(
			(await pool.query("SELECT competitors_mentioned FROM prompt_runs LIMIT 1")).rows[0].competitors_mentioned,
		).toEqual(["Renamed Agent"]);
	});
});
