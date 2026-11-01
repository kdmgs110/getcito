/** Isolated real queue fixtures. CI runs web only; these jobs never execute a paid provider request. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TEST_USER } from "./seed";
import { testDatabaseUrl } from "./test-database";

export const SETTINGS_BRAND = "brand-measurement-settings-e2e";
export const SETTINGS_ENABLED_PROMPTS = [
	"00000000-0000-4000-8000-560000000001",
	"00000000-0000-4000-8000-560000000002",
];
export const SETTINGS_DISABLED_PROMPT = "00000000-0000-4000-8000-560000000003";
const promptIds = [...SETTINGS_ENABLED_PROMPTS, SETTINGS_DISABLED_PROMPT];

export function settingsMeasurementTarget(): string {
	const configured = (process.env.SCRAPE_TARGETS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
	const target = configured.find((value) => value.startsWith("chatgpt:openai-api:")) ?? configured[0];
	if (!target) throw new Error("Settings queue E2E requires the web app's configured SCRAPE_TARGETS");
	return target;
}

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Settings fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try { return await run(client); } finally { await client.end(); }
}

async function queueExists(client: pg.Client): Promise<boolean> {
	const result = await client.query("SELECT to_regclass('pgboss.job') IS NOT NULL AS present");
	return result.rows[0].present;
}

export async function cleanupMeasurementSettingsFixtures() {
	await withClient(async (client) => {
		// No queue/schema-wide cleanup: other suites may have their own queued jobs.
		if (await queueExists(client)) {
			await client.query("DELETE FROM pgboss.job WHERE name='process-prompt' AND data->>'promptId' = ANY($1::text[])", [promptIds]);
		}
		await client.query("DELETE FROM measurement_attempts WHERE brand_id=$1", [SETTINGS_BRAND]);
		await client.query("DELETE FROM prompt_runs WHERE brand_id=$1", [SETTINGS_BRAND]);
		await client.query("DELETE FROM prompts WHERE brand_id=$1", [SETTINGS_BRAND]);
		await client.query("DELETE FROM brands WHERE id=$1", [SETTINGS_BRAND]);
		await client.query("DELETE FROM organization WHERE id=$1", [SETTINGS_BRAND]);
	});
}

export async function seedMeasurementSettingsFixtures() {
	await cleanupMeasurementSettingsFixtures();
	await withClient(async (client) => {
		await client.query("BEGIN");
		try {
			const user = await client.query('SELECT id FROM "user" WHERE email=$1', [TEST_USER.email]);
			if (!user.rows[0]) throw new Error("Settings fixture user must be authenticated first");
			await client.query("INSERT INTO organization(id,name,slug,created_at) VALUES($1,'E2E 計測設定キュー',$1,NOW())", [SETTINGS_BRAND]);
			await client.query("INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'admin',NOW())", [randomUUID(), SETTINGS_BRAND, user.rows[0].id]);
			await client.query("INSERT INTO brands(id,name,website,enabled,onboarded,enabled_targets,target_language,target_market) VALUES($1,'E2E 計測設定キュー','https://settings-queue.example.com/',true,true,ARRAY[]::text[],'Japanese','Japan')", [SETTINGS_BRAND]);
			for (const id of promptIds) {
				await client.query("INSERT INTO prompts(id,brand_id,value,enabled) VALUES($1,$2,$3,$4)", [id, SETTINGS_BRAND, `E2E queue ${id}`, id !== SETTINGS_DISABLED_PROMPT]);
			}
			await client.query("COMMIT");
		} catch (error) { await client.query("ROLLBACK"); throw error; }
	});
}

export async function readMeasurementSettingsQueue() {
	return withClient(async (client) => {
		const jobs = await queueExists(client) ? await client.query<{
			id: string; priority: number; state: string; immediate: boolean;
			data: { promptId: string; singleRun?: boolean; settingsChange?: boolean; targetKeys?: string[]; measurementBatchId?: string };
		}>(`SELECT id,priority,state,data,start_after <= now() AS immediate FROM pgboss.job
			WHERE name='process-prompt' AND data->>'promptId' = ANY($1::text[]) ORDER BY data->>'promptId'`, [promptIds]) : { rows: [] };
		const result = await client.query(`SELECT enabled_targets,
			(SELECT count(*)::int FROM prompt_runs WHERE brand_id=$1) AS runs,
			(SELECT count(*)::int FROM measurement_attempts WHERE brand_id=$1) AS attempts
			FROM brands WHERE id=$1`, [SETTINGS_BRAND]);
		return { jobs: jobs.rows, ...result.rows[0] as { enabled_targets: string[]; runs: number; attempts: number } };
	});
}
