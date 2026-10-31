/** Prompt deletion fixtures may only touch a dedicated local test database. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TEST_USER } from "./seed";
import { testDatabaseUrl } from "./test-database";

export const PROMPT_DELETE_BRAND = "brand-prompt-delete-e2e";
export const PROMPT_OTHER_BRAND = "brand-prompt-delete-other-e2e";
export const DELETE_PROMPT = "E2E 削除するプロンプト";
export const PAUSED_PROMPT = "E2E 停止中で残すプロンプト";
export const CONCURRENT_PROMPT = "E2E 別タブから追加されたプロンプト";
const DELETE_ID = "00000000-0000-4000-8000-440000000001";
const PAUSED_ID = "00000000-0000-4000-8000-440000000002";
const OTHER_ID = "00000000-0000-4000-8000-440000000003";
const BRAND_IDS = [PROMPT_DELETE_BRAND, PROMPT_OTHER_BRAND];

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Prompt fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

export async function cleanupPromptFixtures() {
	await withClient(async (client) => {
		await client.query("DELETE FROM citations WHERE brand_id=ANY($1::text[])", [BRAND_IDS]);
		await client.query("DELETE FROM prompt_runs WHERE brand_id=ANY($1::text[])", [BRAND_IDS]);
		await client.query("DELETE FROM prompts WHERE brand_id=ANY($1::text[])", [BRAND_IDS]);
		await client.query("DELETE FROM brands WHERE id=ANY($1::text[])", [BRAND_IDS]);
		await client.query("DELETE FROM organization WHERE id=ANY($1::text[])", [BRAND_IDS]);
	});
}

export async function seedPromptFixtures() {
	await cleanupPromptFixtures();
	await withClient(async (client) => {
		const users = await client.query('SELECT id FROM "user" WHERE email=$1', [TEST_USER.email]);
		if (!users.rows[0]) throw new Error("Prompt fixture user must be authenticated by global setup first");
		for (const id of BRAND_IDS) {
			await client.query("INSERT INTO organization(id,name,slug,created_at) VALUES($1,$1,$1,NOW())", [id]);
			await client.query(
				"INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'admin',NOW())",
				[randomUUID(), id, users.rows[0].id],
			);
			// Disabled brands cannot accidentally schedule paid provider calls during tests.
			await client.query("INSERT INTO brands(id,name,website,enabled,onboarded) VALUES($1,$1,'https://prompt-test.example.com/',false,true)", [id]);
		}
		for (const [id, brand, value, enabled] of [
			[DELETE_ID, PROMPT_DELETE_BRAND, DELETE_PROMPT, true],
			[PAUSED_ID, PROMPT_DELETE_BRAND, PAUSED_PROMPT, false],
			[OTHER_ID, PROMPT_OTHER_BRAND, "E2E 別ブランドのプロンプト", true],
		] as const) {
			await client.query("INSERT INTO prompts(id,brand_id,value,enabled) VALUES($1,$2,$3,$4)", [id, brand, value, enabled]);
			const run = await client.query(
				`INSERT INTO prompt_runs(prompt_id,brand_id,model,provider,version,web_search_enabled,raw_output,brand_mentioned)
				VALUES($1,$2,'chatgpt','openai-api','e2e-fixture',true,'{}'::json,true) RETURNING id`,
				[id, brand],
			);
			await client.query(
				`INSERT INTO citations(prompt_run_id,prompt_id,brand_id,model,url,domain,title,citation_index,created_at)
				VALUES($1,$2,$3,'chatgpt','https://prompt-test.example.com/','prompt-test.example.com','E2E citation',1,NOW())`,
				[run.rows[0].id, id, brand],
			);
		}
	});
}

export async function readPromptFixtureState() {
	return withClient(async (client) => {
		const rows = await client.query(
			`SELECT p.id,p.enabled,p.value,
			(SELECT count(*)::int FROM prompt_runs r WHERE r.prompt_id=p.id) AS runs,
			(SELECT count(*)::int FROM citations c WHERE c.prompt_id=p.id) AS citations
			FROM prompts p WHERE p.brand_id=ANY($1::text[]) ORDER BY p.id`,
			[BRAND_IDS],
		);
		const deletedChildren = await client.query(
			`SELECT (SELECT count(*)::int FROM prompt_runs WHERE prompt_id=$1) AS runs,
			(SELECT count(*)::int FROM citations WHERE prompt_id=$1) AS citations`,
			[DELETE_ID],
		);
		return { prompts: rows.rows, deletedChildren: deletedChildren.rows[0] };
	});
}

/** Simulates another tab adding a row after the editor's initial snapshot. */
export async function insertConcurrentPrompt() {
	await withClient(async (client) => {
		await client.query("INSERT INTO prompts(brand_id,value,enabled) VALUES($1,$2,false)", [PROMPT_DELETE_BRAND, CONCURRENT_PROMPT]);
	});
}

/** A real FK-boundary failure proves that deleting children and their prompt is atomic. */
export async function setPromptDeleteFailure(enabled: boolean) {
	await withClient(async (client) => {
		await client.query("DROP TRIGGER IF EXISTS prompt_e2e_fail_delete ON prompts");
		await client.query("DROP FUNCTION IF EXISTS prompt_e2e_fail_delete()");
		if (enabled) {
			await client.query(`CREATE FUNCTION prompt_e2e_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				IF OLD.id = '${DELETE_ID}'::uuid THEN RAISE EXCEPTION 'Injected E2E prompt deletion failure'; END IF;
				RETURN OLD;
			END; $$`);
			await client.query("CREATE TRIGGER prompt_e2e_fail_delete BEFORE DELETE ON prompts FOR EACH ROW EXECUTE FUNCTION prompt_e2e_fail_delete()");
		}
	});
}
