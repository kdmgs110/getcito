import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Explicit opt-in only. The production query runs against temporary tables in
// a random schema, never against existing brands, runs, or migration state.
const testUrl = process.env.DATAFORSEO_TEST_DATABASE_URL;
const schema = `visibility_test_${randomUUID().replaceAll("-", "")}`;
const brandId = `visibility-${randomUUID()}`;
const foreignBrandId = `visibility-${randomUUID()}`;
const promptId = randomUUID();
const emptyPromptId = randomUUID();
const disabledPromptId = randomUUID();
const foreignPromptId = randomUUID();
const currentRunId = randomUUID();
const aiRunId = randomUUID();
const legacyRunId = randomUUID();
const asOf = "2026-11-03T02:00:00.000Z";
let client: Client | undefined;
let initialized = false;
let getRows: typeof import("./visibility-spreadsheet").getVisibilitySpreadsheetRowsFn;
let database: typeof import("@workspace/lib/db/db").db | undefined;

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validator: { parse: (value: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) =>
				fn({ data: validator.parse(input.data) }),
		}),
	}),
}));
const auth = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: auth.session, requireOrgAccess: auth.access }));
// The deployment pins this value at Vite build time. Exercise the production
// Japanese calendar explicitly, regardless of the test runner's host timezone.
vi.mock("@/lib/app-locale", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-locale")>()),
	APP_TIMEZONE: "Asia/Tokyo",
}));

describe.skipIf(!testUrl)("visibility spreadsheet (PostgreSQL)", () => {
	beforeAll(async () => {
		const url = new URL(testUrl ?? "");
		if (!/^\/(codex_|test_)/.test(url.pathname) && url.pathname !== "/getcito_test")
			throw new Error("Use an isolated codex_ or test_ database");
		client = new Client({ connectionString: url.toString() });
		await client.connect();
		await client.query(`CREATE SCHEMA "${schema}"`);
		initialized = true;
		await client.query(`SET search_path TO "${schema}"`);
		// Match the production columns used by this read endpoint. Creating only
		// these tables lets the check run before application migrations in CI.
		await client.query(`
			CREATE TABLE brands (id text PRIMARY KEY, name text NOT NULL, website text NOT NULL DEFAULT '', aliases text[] NOT NULL DEFAULT '{}', additional_domains text[] NOT NULL DEFAULT '{}');
			CREATE TABLE brand_mention_recounts (brand_id text PRIMARY KEY, id uuid, completed_at timestamptz);
			CREATE TABLE competitors (id uuid PRIMARY KEY, brand_id text NOT NULL, name text NOT NULL, domains text[] NOT NULL DEFAULT '{}', aliases text[] NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
			CREATE TABLE prompts (id uuid PRIMARY KEY, brand_id text NOT NULL, value text NOT NULL, tags text[] NOT NULL, enabled boolean NOT NULL);
			CREATE TABLE prompt_runs (id uuid PRIMARY KEY, brand_id text NOT NULL, prompt_id uuid NOT NULL, model text NOT NULL,
				provider text, created_at timestamptz NOT NULL, web_search_enabled boolean NOT NULL, brand_mentioned boolean NOT NULL,
				competitors_mentioned text[] NOT NULL, web_queries text[] NOT NULL, raw_output json NOT NULL, mention_analysis jsonb);
			CREATE TABLE measurement_attempts (id uuid PRIMARY KEY, prompt_run_id uuid, brand_id text NOT NULL, prompt_id uuid NOT NULL,
				model text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL, evidence jsonb);
			CREATE TABLE citations (prompt_run_id uuid NOT NULL, brand_id text NOT NULL, url text NOT NULL, title text);
		`);
		await client.query("INSERT INTO brands(id,name) VALUES ($1,'自社ブランド'),($2,'他社ブランド')", [
			brandId,
			foreignBrandId,
		]);
		await client.query(
			"INSERT INTO prompts VALUES ($1,$2,'Rails 案件を探して',ARRAY['フルリモート','高単価'],true),($3,$2,'未取得',ARRAY[]::text[],true),($4,$2,'無効',ARRAY[]::text[],false),($5,$6,'他社プロンプト',ARRAY[]::text[],true)",
			[promptId, brandId, emptyPromptId, disabledPromptId, foreignPromptId, foreignBrandId],
		);
		const insertRun = async (options: {
			id?: string;
			model?: string;
			provider?: string;
			createdAt: string;
			answer: string;
			status?: "succeeded" | "failed" | "running";
			webSearch?: boolean;
		}) => {
			if (!client) throw new Error("Missing fixture connection");
			const id = options.id ?? randomUUID();
			const model = options.model ?? "chatgpt";
			const provider = options.provider ?? "dataforseo-scraper";
			const raw =
				model === "google-ai-mode"
					? { tasks: [{ result: [{ items: [{ type: "ai_overview", markdown: options.answer }] }] }] }
					: {
							status_code: 20000,
							tasks: [
								{
									status_code: 20000,
									result: [
										{
											markdown: options.answer,
											search_results: [{ url: "https://example.com/rails" }, { url: "https://example.com/rails" }],
											sources: [{ url: "https://example.com/rails" }],
										},
									],
								},
							],
						};
			await client.query(
				"INSERT INTO prompt_runs(id,brand_id,prompt_id,model,provider,created_at,web_search_enabled,brand_mentioned,competitors_mentioned,web_queries,raw_output) VALUES($1,$2,$3,$4,$5,$6,$7,true,ARRAY['競合ブランド'],ARRAY['Rails 案件'],$8::json)",
				[id, brandId, promptId, model, provider, options.createdAt, options.webSearch ?? true, JSON.stringify(raw)],
			);
			if (options.status)
				await client.query("INSERT INTO measurement_attempts VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [
					randomUUID(),
					id,
					brandId,
					promptId,
					model,
					options.status,
					options.createdAt,
					JSON.stringify({
						version: 1,
						answerText: options.answer,
						answerStatus: "shown",
						queryStatus: "observed",
						queryEvidence: [],
					}),
				]);
		};
		await insertRun({ id: legacyRunId, createdAt: "2026-10-10T01:00:00Z", answer: "過去の回答" });
		await insertRun({
			id: currentRunId,
			createdAt: "2026-11-02T15:01:00Z",
			answer: "現在の成功回答",
			status: "succeeded",
		});
		await insertRun({
			id: aiRunId,
			createdAt: "2026-11-02T16:00:00Z",
			model: "google-ai-mode",
			provider: "dataforseo",
			answer: "AIモードの回答",
			status: "succeeded",
		});
		await insertRun({ createdAt: "2026-11-03T01:00:00Z", answer: "失敗した計測の回答", status: "failed" });
		await insertRun({ createdAt: "2026-11-03T01:15:00Z", answer: "処理中の回答", status: "running" });
		await insertRun({ createdAt: "2026-11-03T01:30:00Z", provider: "brightdata", answer: "廃止プロバイダ" });
		await insertRun({ createdAt: "2026-11-03T01:40:00Z", provider: "openai-api", answer: "APIの回答" });
		await insertRun({ createdAt: "2026-11-03T01:50:00Z", webSearch: false, answer: "オフラインの回答" });
		await insertRun({ createdAt: "2026-11-03T03:00:00Z", answer: "スナップショット後の成功回答", status: "succeeded" });
		await client.query("INSERT INTO citations VALUES($1,$2,'https://example.com/rails','Railsのページ')", [
			currentRunId,
			brandId,
		]);
		url.searchParams.set("options", `-c search_path=${schema}`);
		vi.stubEnv("DATABASE_URL", url.toString());
		vi.stubEnv("DATABASE_SSL_MODE", "disable");
		vi.stubEnv("DB_POOL_MAX", "2");
		auth.session.mockResolvedValue({ user: { id: "fixture-member" } });
		auth.access.mockImplementation(async (_userId: string, requestedBrand: string) => {
			if (requestedBrand !== brandId) throw new Error("Forbidden");
		});
		database = (await import("@workspace/lib/db/db")).db;
		getRows = (await import("./visibility-spreadsheet")).getVisibilitySpreadsheetRowsFn;
	});
	afterAll(async () => {
		await database?.$client.end();
		if (initialized) await client?.query(`DROP SCHEMA "${schema}" CASCADE`);
		await client?.end();
		vi.unstubAllEnvs();
	});

	it("queries latest successful canonical runs and preserves caller order and saved categories", async () => {
		const result = await getRows({ data: { brandId, promptIds: [emptyPromptId, promptId], lookback: "1m", asOf } });
		expect(result.rows.map((row) => row.id)).toEqual([emptyPromptId, promptId]);
		expect(result.rows[0]).toMatchObject({ chatgpt: null, aiMode: null, lastRunAt: null });
		expect(result.rows[1]).toMatchObject({
			tags: ["フルリモート", "高単価"],
			lastRunAt: "2026-11-02T16:00:00.000Z",
			chatgpt: { runId: currentRunId, answerText: "現在の成功回答", mentionedBrands: ["自社ブランド", "競合ブランド"] },
			aiMode: { runId: aiRunId, answerText: "AIモードの回答" },
		});
	});
	it("loads historical page receipts when normalized answer evidence predates page evidence", async () => {
		const result = await getRows({ data: { brandId, promptIds: [promptId], lookback: "all", asOf } });
		expect(result.rows[0].chatgpt?.pages).toEqual([
			{ url: "https://example.com/rails", domain: "example.com", title: "", appearances: 2, citations: 1 },
		]);
	});
	it("keeps a timestamp snapshot stable while allowing a later explicit snapshot", async () => {
		const before = await getRows({
			data: { brandId, promptIds: [promptId], lookback: "all", asOf: "2026-11-02T15:00:00.000Z" },
		});
		expect(before.rows[0].chatgpt?.runId).toBe(legacyRunId);
		expect(before.rows[0].aiMode).toBeNull();
		const after = await getRows({
			data: { brandId, promptIds: [promptId], lookback: "all", asOf: "2026-11-03T04:00:00.000Z" },
		});
		expect(after.rows[0].chatgpt?.answerText).toBe("スナップショット後の成功回答");
	});
	it("applies inclusive JST custom calendar ranges and retains prompts without period results", async () => {
		const inDay = await getRows({
			data: { brandId, promptIds: [promptId], lookback: "custom:2026-11-03:2026-11-03", asOf },
		});
		expect(inDay.rows[0].chatgpt?.runId).toBe(currentRunId);
		const previousDay = await getRows({
			data: { brandId, promptIds: [promptId], lookback: "custom:2026-11-02:2026-11-02", asOf },
		});
		expect(previousDay.rows[0]).toMatchObject({ chatgpt: null, aiMode: null, lastRunAt: null });
		const historic = await getRows({
			data: { brandId, promptIds: [promptId], lookback: "custom:2026-10-10:2026-10-10", asOf },
		});
		expect(historic.rows[0].chatgpt?.runId).toBe(legacyRunId);
	});
	it("omits disabled and foreign prompt IDs even when supplied with an accessible brand", async () => {
		const result = await getRows({
			data: { brandId, promptIds: [foreignPromptId, promptId, disabledPromptId], lookback: "all", asOf },
		});
		expect(result.rows.map((row) => row.id)).toEqual([promptId]);
		await expect(
			getRows({ data: { brandId: foreignBrandId, promptIds: [foreignPromptId], lookback: "all", asOf } }),
		).rejects.toThrow("Forbidden");
	});
});
