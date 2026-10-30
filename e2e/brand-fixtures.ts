/** Brand-flow fixtures are isolated from the GA4/CV suites and require a dedicated local test DB. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TEST_USER } from "./seed";
import { testDatabaseUrl } from "./test-database";

export const BRAND_FLOW_ID = "brand-flow-e2e";
export const BRAND_OTHER_ID = "brand-flow-other-e2e";
export const BRAND_FLOW_NAME = "E2E ブランド検証 元サイト";
export const BRAND_OTHER_NAME = "E2E ブランド検証 別サイト";
export const NEW_BRAND_PREFIX = "E2E 新規ブランド検証";
export const RETRY_BRAND_NAME = `${NEW_BRAND_PREFIX} 保存再試行`;

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Brand fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

export async function cleanupBrandFlowFixtures() {
	await withClient(async (client) => {
		const rows = await client.query("SELECT id FROM brands WHERE name LIKE $1 OR id = ANY($2::text[])", [
			`${NEW_BRAND_PREFIX}%`,
			[BRAND_FLOW_ID, BRAND_OTHER_ID],
		]);
		const ids = rows.rows.map((row) => row.id);
		if (ids.length) {
			await client.query("DELETE FROM brands WHERE id = ANY($1::text[])", [ids]);
			await client.query("DELETE FROM organization WHERE id = ANY($1::text[])", [ids]);
		}
	});
}

export async function seedBrandFlowFixtures() {
	await cleanupBrandFlowFixtures();
	await withClient(async (client) => {
		const users = await client.query('SELECT id FROM "user" WHERE email=$1', [TEST_USER.email]);
		if (!users.rows[0]) throw new Error("Brand fixture user must be authenticated by global setup first");
		for (const [id, name, website] of [
			[BRAND_FLOW_ID, BRAND_FLOW_NAME, "https://brand-flow.example.com/"],
			[BRAND_OTHER_ID, BRAND_OTHER_NAME, "https://brand-other.example.com/"],
		]) {
			await client.query("INSERT INTO organization(id,name,slug,created_at) VALUES($1,$2,$1,NOW())", [id, name]);
			await client.query(
				"INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'admin',NOW())",
				[randomUUID(), id, users.rows[0].id],
			);
			await client.query("INSERT INTO brands(id,name,website,enabled,onboarded) VALUES($1,$2,$3,true,false)", [
				id,
				name,
				website,
			]);
		}
	});
}

export async function readCreatedBrand(name: string) {
	return withClient(async (client) => {
		const rows = await client.query(
			`SELECT b.id,b.name,b.website,b.target_market,b.target_language,o.id AS organization_id,
			(SELECT count(*)::int FROM member m WHERE m.organization_id=b.id AND m.role='admin') AS admins,
			(SELECT count(*)::int FROM ga4_connections g WHERE g.brand_id=b.id) AS ga4_connections,
			(SELECT count(*)::int FROM traffic_saved_views v WHERE v.brand_id=b.id) AS views,
			(SELECT count(*)::int FROM conversion_goals c WHERE c.brand_id=b.id) AS goals
			FROM brands b LEFT JOIN organization o ON o.id=b.id WHERE b.name=$1`,
			[name],
		);
		return rows.rows;
	});
}

/** Fail exactly one fixture name at the real database boundary to verify rollback and safe retry. */
export async function setBrandInsertFailure(enabled: boolean) {
	await withClient(async (client) => {
		await client.query("DROP TRIGGER IF EXISTS brand_e2e_fail_insert ON brands");
		await client.query("DROP FUNCTION IF EXISTS brand_e2e_fail_insert()");
		if (enabled) {
			await client.query(`CREATE FUNCTION brand_e2e_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW.name = 'E2E 新規ブランド検証 保存再試行' THEN
					RAISE EXCEPTION 'Injected E2E brand insert failure';
				END IF;
				RETURN NEW;
			END; $$`);
			await client.query("CREATE TRIGGER brand_e2e_fail_insert BEFORE INSERT ON brands FOR EACH ROW EXECUTE FUNCTION brand_e2e_fail_insert()");
		}
	});
}

export async function countBrandOrganizations(name: string): Promise<number> {
	return withClient(async (client) => {
		const rows = await client.query("SELECT count(*)::int AS count FROM organization WHERE name=$1", [name]);
		return rows.rows[0].count;
	});
}
