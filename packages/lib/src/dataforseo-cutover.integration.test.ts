import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseDataForSeoTaskStore as store } from "./providers/dataforseo-task-store";

// Explicit opt-in, against an isolated test database only. Every object lives
// in a random schema, removed afterwards; no existing schema is modified.
const testUrl = process.env.DATAFORSEO_TEST_DATABASE_URL;
const schema = `dfs_test_${randomUUID().replaceAll("-", "")}`;
let client: Client;
let initialized = false;

describe.skipIf(!testUrl)("DataForSEO durable receipts and ChatGPT Web cutover (PostgreSQL)", () => {
	beforeAll(async () => {
		const url = new URL(testUrl ?? "");
		if (!/^\/(codex_|test_)/.test(url.pathname) && url.pathname !== "/getcito_test")
			throw new Error("Use an isolated codex_ or test_ database");
		client = new Client({ connectionString: url.toString() });
		await client.connect();
		await client.query(`CREATE SCHEMA "${schema}"`);
		initialized = true;
		await client.query(`SET search_path TO "${schema}"`);
		await client.query(await readFile(new URL("./db/migrations/0019_dataforseo_tasks.sql", import.meta.url), "utf8"));
		await client.query(`CREATE TABLE brands (id text PRIMARY KEY, enabled boolean DEFAULT true, enabled_models text[], enabled_targets text[], updated_at timestamptz DEFAULT '2020-01-01');
   CREATE TABLE measurement_attempts (id text PRIMARY KEY, model text, provider text, status text, error_code text, completed_at timestamptz, raw_output jsonb, prompt_id text, brand_id text, batch_id text, target_key text, started_at timestamptz DEFAULT now());
   CREATE TABLE prompts (id text PRIMARY KEY, enabled boolean DEFAULT true);
   CREATE TABLE prompt_runs (id text PRIMARY KEY, provider text, raw_output jsonb);
   CREATE TABLE citations (id text PRIMARY KEY, url text);`);
		url.searchParams.set("options", `-c search_path=${schema}`);
		vi.stubEnv("DATABASE_URL", url.toString());
		vi.stubEnv("DATABASE_SSL_MODE", "disable");
		vi.stubEnv("DB_POOL_MAX", "2");
	});
	afterAll(async () => {
		if (initialized) {
			const { db } = await import("./db/db");
			await db.$client.end();
			await client.query(`DROP SCHEMA "${schema}" CASCADE`);
		}
		await client?.end();
		vi.unstubAllEnvs();
	});

	it("claims a logical scrape exactly once under concurrent workers and reloads its receipt", async () => {
		const claims = await Promise.all(
			Array.from({ length: 8 }, () => store.claim("measurement:attempt-1", "same-request-hash")),
		);
		expect(claims.filter((claim) => claim.created)).toHaveLength(1);
		expect((await client.query("SELECT count(*)::int AS count FROM dataforseo_tasks")).rows[0].count).toBe(1);
		await store.submitted("measurement:attempt-1", "provider-task-123");
		const resumed = await store.claim("measurement:attempt-1", "same-request-hash");
		expect(resumed).toMatchObject({
			created: false,
			task: { taskId: "provider-task-123", status: "submitted", requestHash: "same-request-hash" },
		});
		await store.failed("measurement:attempt-1", "result_failed_40403");
		expect((await store.claim("measurement:attempt-1", "same-request-hash")).task).toMatchObject({
			status: "failed",
			errorCode: "result_failed_40403",
			taskId: "provider-task-123",
		});
	});

	it("preserves unconfirmed submissions instead of allowing a second claim to POST", async () => {
		expect((await store.claim("measurement:uncertain", "hash")).created).toBe(true);
		expect(await store.claim("measurement:uncertain", "hash")).toMatchObject({
			created: false,
			task: { status: "submitting", taskId: null },
		});
	});

	it("recovery SQL queues only stale known paid tasks and blocks new paid cycles for all pending tasks", async () => {
		await client.query(`INSERT INTO brands(id) VALUES ('recovery-brand'); INSERT INTO prompts(id) VALUES ('fresh'),('stale'),('failed'),('permanent'),('uncertain');
   INSERT INTO measurement_attempts(id,model,provider,status,error_code,prompt_id,brand_id,batch_id,target_key,started_at,completed_at) VALUES
   ('fresh','chatgpt','dataforseo-scraper','queued',NULL,'fresh','recovery-brand','batch','chatgpt:dataforseo-scraper:online',now(),NULL),
   ('stale','chatgpt','dataforseo-scraper','queued',NULL,'stale','recovery-brand','batch','chatgpt:dataforseo-scraper:online',now()-interval '21 minutes',NULL),
   ('failed','chatgpt','dataforseo-scraper','failed','payment_required','failed','recovery-brand','batch','chatgpt:dataforseo-scraper:online',now(),now()-interval '16 minutes'),
   ('permanent','chatgpt','dataforseo-scraper','failed','result_failed_40403','permanent','recovery-brand','batch','chatgpt:dataforseo-scraper:online',now(),now()-interval '16 minutes'),
   ('uncertain','chatgpt','dataforseo-scraper','failed','submission_unconfirmed','uncertain','recovery-brand','batch','chatgpt:dataforseo-scraper:online',now(),now()-interval '16 minutes');`);
		for (const id of ["fresh", "stale", "failed", "permanent", "uncertain"]) {
			await store.claim(`measurement:${id}`, "hash");
			if (id !== "uncertain") await store.submitted(`measurement:${id}`, `task-${id}`);
		}
		const { recoverDataForSeoTasks, hasPendingDataForSeoTask } = await import(
			"../../../apps/worker/src/jobs/recover-dataforseo"
		);
		const enqueue = vi.fn().mockResolvedValue("job");
		const pending = await recoverDataForSeoTasks(enqueue);
		expect([...pending].sort()).toEqual(["failed", "fresh", "stale", "uncertain"]);
		expect(enqueue.mock.calls.map(([data]) => data.resumeDataForSeoAttemptId).sort()).toEqual(["failed", "stale"]);
		expect(enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				promptId: "stale",
				singleRun: true,
				measurementBatchId: "batch",
				resumeDataForSeoAttemptId: "stale",
			}),
			expect.objectContaining({ retryLimit: 0 }),
		);
		expect(await hasPendingDataForSeoTask("fresh", "other-batch")).toBe(true);
		expect(await hasPendingDataForSeoTask("fresh", "batch")).toBe(false);
		await client.query("UPDATE brands SET enabled_targets='{}' WHERE id='recovery-brand'");
		expect(await recoverDataForSeoTasks(enqueue)).toEqual(new Set());
		await client.query("UPDATE brands SET enabled_targets=NULL,enabled_models='{}' WHERE id='recovery-brand'");
		expect(await recoverDataForSeoTasks(enqueue)).toEqual(new Set());
		expect(await recoverDataForSeoTasks(enqueue, new Set())).toEqual(new Set());
	});

	it("migrates active settings and unfinished retired attempts while preserving historical data", async () => {
		const canonical = "chatgpt:dataforseo-scraper:online";
		await client.query(`INSERT INTO brands(id,enabled_targets) VALUES
   ('legacy-default',NULL), ('disabled','{}'),
   ('mixed',ARRAY['chatgpt:brightdata:online','chatgpt:olostep','chatgpt:dataforseo-scraper:online','claude:openrouter:v1']),
   ('dfs-offline',ARRAY['chatgpt:dataforseo-scraper']),
   ('retired-only',ARRAY['google-ai-overview:brightdata:online']),
   ('current',ARRAY['chatgpt:dataforseo-scraper:online']);
   INSERT INTO measurement_attempts(id,model,provider,status,raw_output) VALUES
   ('old-queued','chatgpt','brightdata','queued','{"answer":"old"}'),
   ('old-running','chatgpt','olostep','running',NULL),
   ('old-completed','chatgpt','brightdata','succeeded','{"answer":"keep"}'),
   ('new-queued','chatgpt','dataforseo-scraper','queued',NULL),
   ('other-running','google-ai-overview','cloro','running',NULL);
   INSERT INTO prompt_runs VALUES ('history','brightdata','{"answer":"unchanged","queries":["original"]}');
   INSERT INTO citations VALUES ('citation','https://example.com/original');`);
		const beforeRuns = (await client.query("SELECT * FROM prompt_runs")).rows;
		const beforeCitations = (await client.query("SELECT * FROM citations")).rows;
		const migration = await readFile(new URL("./db/migrations/0020_chatgpt_web_cutover.sql", import.meta.url), "utf8");
		await client.query(migration);
		const brands = new Map(
			(await client.query("SELECT id,enabled_targets FROM brands")).rows.map((brand) => [
				brand.id,
				brand.enabled_targets,
			]),
		);
		expect(brands.get("legacy-default")).toBeNull();
		expect(brands.get("disabled")).toEqual([]);
		expect(brands.get("mixed")).toEqual([canonical, "claude:openrouter:v1"]);
		expect(brands.get("dfs-offline")).toEqual([canonical]);
		expect(brands.get("retired-only")).toEqual([]);
		expect(brands.get("current")).toEqual([canonical]);
		const attempts = new Map(
			(await client.query("SELECT * FROM measurement_attempts")).rows.map((attempt) => [attempt.id, attempt]),
		);
		expect(attempts.get("old-queued")).toMatchObject({
			status: "failed",
			error_code: "provider_retired",
			raw_output: { answer: "old" },
		});
		expect(attempts.get("old-running")).toMatchObject({ status: "failed", error_code: "provider_retired" });
		expect(attempts.get("old-completed")).toMatchObject({ status: "succeeded", raw_output: { answer: "keep" } });
		expect(attempts.get("new-queued")).toMatchObject({ status: "queued", error_code: null });
		expect(attempts.get("other-running")).toMatchObject({ status: "running", error_code: null });
		expect((await client.query("SELECT * FROM prompt_runs")).rows).toEqual(beforeRuns);
		expect((await client.query("SELECT * FROM citations")).rows).toEqual(beforeCitations);
		// Running the migration twice changes neither the history nor the settings.
		await client.query(migration);
		expect((await client.query("SELECT * FROM prompt_runs")).rows).toEqual(beforeRuns);
		expect((await client.query("SELECT * FROM citations")).rows).toEqual(beforeCitations);
		expect((await client.query("SELECT enabled_targets FROM brands WHERE id='mixed'")).rows[0].enabled_targets).toEqual(
			[canonical, "claude:openrouter:v1"],
		);
	});
});
