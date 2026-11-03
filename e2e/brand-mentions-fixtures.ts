/** Stored-answer fixtures only. No acquisition worker or paid provider is run. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { require as tsRequire } from "tsx/cjs/api";
import { TEST_USER } from "./seed";
import { testDatabaseUrl } from "./test-database";

export const MENTION_BRAND = "brand-mention-e2e";
export const MENTION_OWN = "E2E Rails Brand";
export const MENTION_COMPETITOR = "E2E Existing Agent";
export const MENTION_CANDIDATE = "E2E New Agent";
export const MENTION_OLD_ALIAS = "E2E Old Rails Name";
export const MENTION_TARGET = "chatgpt:dataforseo-scraper:online";
export const MENTION_AI_TARGET = "google-ai-mode:dataforseo:online";
export const MENTION_PROMPT = "00000000-0000-4000-8000-590000000001";
export const MENTION_CHAT_RUN = "00000000-0000-4000-8000-590000000002";
export const MENTION_OLD_RUN = "00000000-0000-4000-8000-590000000003";
export const MENTION_AI_RUN = "00000000-0000-4000-8000-590000000004";
export const MENTION_COMPETITOR_ID = "00000000-0000-4000-8000-590000000005";
export const MENTION_NO_ANSWER_ATTEMPT = "00000000-0000-4000-8000-590000000006";
export const MENTION_LINKED_PROMPT = "00000000-0000-4000-8000-590000000007";
export const MENTION_LINKED_RUN = "00000000-0000-4000-8000-590000000008";
export const MENTION_JOB_TITLE = "Railsフルリモート開発案件";
export const MENTION_JOB_URL = "https://jobs.brand-mentions.example.com/projects/rails-remote";
export const MENTION_JOB_DOMAIN = "jobs.brand-mentions.example.com";
export const MENTION_JOB_BRAND = "E2E Linked Job Service";
export const MENTION_ANSWER = `おすすめのサービス\n1. ${MENTION_COMPETITOR}\n2. ${MENTION_OWN}\n3. ${MENTION_CANDIDATE}`;
export const MENTION_OLD_ANSWER = `以前の回答\n1. ${MENTION_OLD_ALIAS}\n2. ${MENTION_CANDIDATE}`;
export const MENTION_AI_ANSWER = `Google AIモードの回答\n1. ${MENTION_OWN}\n2. ${MENTION_COMPETITOR}`;

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Brand mention fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try { return await run(client); } finally { await client.end(); }
}

export async function cleanupBrandMentionFixtures() {
	await withClient(async (client) => {
		await client.query("DELETE FROM pgboss.job WHERE name='recount-brand-mentions' AND data->>'brandId'=$1", [MENTION_BRAND]).catch(() => {});
		for (const table of ["brand_mention_recount_rows", "brand_mention_recounts", "measurement_attempts", "citations", "prompt_runs", "prompts", "competitors"]) {
			await client.query(`DELETE FROM ${table} WHERE brand_id=$1`, [MENTION_BRAND]);
		}
		await client.query("DELETE FROM brands WHERE id=$1", [MENTION_BRAND]);
		await client.query("DELETE FROM organization WHERE id=$1", [MENTION_BRAND]);
	});
}

export async function seedBrandMentionFixtures() {
	await cleanupBrandMentionFixtures();
	await withClient(async (client) => {
		await client.query("BEGIN");
		try {
			const user = await client.query('SELECT id FROM "user" WHERE email=$1', [TEST_USER.email]);
			if (!user.rows[0]) throw new Error("Authenticate the fixture user before seeding brand mentions");
			await client.query("INSERT INTO organization(id,name,slug,created_at) VALUES($1,$2,$1,NOW())", [MENTION_BRAND, MENTION_OWN]);
			await client.query("INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'admin',NOW())", [randomUUID(), MENTION_BRAND, user.rows[0].id]);
			await client.query("INSERT INTO brands(id,name,website,enabled,onboarded,enabled_targets,target_language,target_market) VALUES($1,$2,'https://own.brand-mentions.example.com',false,true,$3,'Japanese','Japan')", [MENTION_BRAND, MENTION_OWN, [MENTION_TARGET, MENTION_AI_TARGET]]);
			await client.query("INSERT INTO competitors(id,brand_id,name,domains) VALUES($1,$2,$3,$4)", [MENTION_COMPETITOR_ID, MENTION_BRAND, MENTION_COMPETITOR, ["existing.brand-mentions.example.com"]]);
			await client.query("INSERT INTO prompts(id,brand_id,value,enabled,tags,system_tags) VALUES($1,$2,'E2E ブランド順位の比較',true,$3,$4)", [MENTION_PROMPT, MENTION_BRAND, ["ブランド順位"], ["unbranded"]]);
			const context = { version: 1, prompt: "E2E ブランド順位の比較", targetLanguage: "Japanese", targetMarket: "Japan", languageCode: "ja", countryCode: "jp" };
			for (const [id, answer, aiMode, age] of [
				[MENTION_OLD_RUN, MENTION_OLD_ANSWER, false, 120],
				[MENTION_CHAT_RUN, MENTION_ANSWER, false, 5],
				[MENTION_AI_RUN, MENTION_AI_ANSWER, true, 4],
			] as const) {
				const model = aiMode ? "google-ai-mode" : "chatgpt";
				const provider = aiMode ? "dataforseo" : "dataforseo-scraper";
				const target = aiMode ? MENTION_AI_TARGET : MENTION_TARGET;
				const queries = ["E2E Rails brand order"];
				const evidence = { version: 1, answerText: answer, answerStatus: "shown", queryStatus: "observed", queryEvidence: [], pageEvidence: { version: 1, search: { status: "known", items: [] }, citations: { status: "known", items: [] } } };
				await client.query(`INSERT INTO prompt_runs(id,prompt_id,brand_id,model,provider,version,web_search_enabled,raw_output,web_queries,brand_mentioned,competitors_mentioned,request_context,created_at)
					VALUES($1,$2,$3,$4,$5,'e2e',true,$6::json,$7,$8,$9,$10::jsonb,NOW()-($11::int*INTERVAL '1 minute'))`, [id, MENTION_PROMPT, MENTION_BRAND, model, provider, JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ markdown: answer, fan_out_queries: queries, search_results: [], sources: [] }] }] }), queries, id !== MENTION_OLD_RUN, id === MENTION_OLD_RUN ? [] : [MENTION_COMPETITOR], JSON.stringify(context), age]);
				await client.query(`INSERT INTO measurement_attempts(id,batch_id,brand_id,prompt_id,target_key,model,provider,status,web_search_enabled,request_context,evidence,prompt_run_id,created_at,completed_at)
					VALUES($1,$2,$3,$4,$5,$6,$7,'succeeded',true,$8::jsonb,$9::jsonb,$10,NOW()-($11::int*INTERVAL '1 minute'),NOW()-($11::int*INTERVAL '1 minute'))`, [randomUUID(), randomUUID(), MENTION_BRAND, MENTION_PROMPT, target, model, provider, JSON.stringify(context), JSON.stringify(evidence), id, age]);
			}
			await client.query(`INSERT INTO measurement_attempts(id,batch_id,brand_id,prompt_id,target_key,model,provider,status,web_search_enabled,request_context,evidence,created_at,completed_at)
				VALUES($1,$2,$3,$4,$5,'google-ai-mode','dataforseo','succeeded',true,$6::jsonb,$7::jsonb,NOW()-INTERVAL '1 minute',NOW()-INTERVAL '1 minute')`, [MENTION_NO_ANSWER_ATTEMPT, randomUUID(), MENTION_BRAND, MENTION_PROMPT, MENTION_AI_TARGET, JSON.stringify(context), JSON.stringify({ version: 1, answerText: "", answerStatus: "not_shown", queryStatus: "not_exposed", queryEvidence: [] })]);
			await client.query("COMMIT");
		} catch (error) { await client.query("ROLLBACK"); throw error; }
	});
}

/** A grounded job title and its URL come from the same stored answer item. */
export async function seedLinkedJobMentionFixture() {
	await withClient(async (client) => {
		const answer = `おすすめのRails案件\n1. [${MENTION_JOB_TITLE}](${MENTION_JOB_URL})\n2. ${MENTION_OWN}`;
		const context = { version: 1, prompt: "E2E Rails案件のブランド登録", targetLanguage: "Japanese", targetMarket: "Japan", languageCode: "ja", countryCode: "jp" };
		await client.query("INSERT INTO prompts(id,brand_id,value,enabled,tags,system_tags) VALUES($1,$2,$3,true,$4,$5)", [MENTION_LINKED_PROMPT, MENTION_BRAND, context.prompt, ["ブランド順位"], ["unbranded"]]);
		await client.query(`INSERT INTO prompt_runs(id,prompt_id,brand_id,model,provider,version,web_search_enabled,raw_output,web_queries,brand_mentioned,competitors_mentioned,request_context,created_at)
			VALUES($1,$2,$3,'chatgpt','dataforseo-scraper','e2e',true,$4::json,$5,true,$6,$7::jsonb,NOW()-INTERVAL '2 minutes')`, [MENTION_LINKED_RUN, MENTION_LINKED_PROMPT, MENTION_BRAND, JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ markdown: answer, fan_out_queries: [], search_results: [], sources: [] }] }] }), [], [], JSON.stringify(context)]);
		await client.query(`INSERT INTO measurement_attempts(id,batch_id,brand_id,prompt_id,target_key,model,provider,status,web_search_enabled,request_context,evidence,prompt_run_id,created_at,completed_at)
			VALUES($1,$2,$3,$4,$5,'chatgpt','dataforseo-scraper','succeeded',true,$6::jsonb,$7::jsonb,$8,NOW()-INTERVAL '2 minutes',NOW()-INTERVAL '2 minutes')`, [randomUUID(), randomUUID(), MENTION_BRAND, MENTION_LINKED_PROMPT, MENTION_TARGET, JSON.stringify(context), JSON.stringify({ version: 1, answerText: answer, answerStatus: "shown", queryStatus: "observed", queryEvidence: [], pageEvidence: { version: 1, search: { status: "known", items: [] }, citations: { status: "known", items: [] } } }), MENTION_LINKED_RUN]);
	});
}

/** Invoke the exact production recount handler, without starting an acquisition worker. */
export async function completeBrandMentionRecount() {
	const id = await withClient(async (client) => {
		const row = await client.query<{ id: string }>("SELECT id FROM brand_mention_recounts WHERE brand_id=$1", [MENTION_BRAND]);
		if (!row.rows[0]) throw new Error("The registration did not enqueue a recount");
		return row.rows[0].id;
	});
	process.env.DATABASE_URL = testDatabaseUrl();
	const { processMentionRecount } = tsRequire("../packages/lib/src/brand-mention-recount.ts", import.meta.url) as typeof import("../packages/lib/src/brand-mention-recount");
	await processMentionRecount(MENTION_BRAND, id);
}

export async function failBrandMentionRecount() {
	await withClient((client) => client.query("UPDATE brand_mention_recounts SET status='failed' WHERE brand_id=$1", [MENTION_BRAND]));
}

export async function brandMentionSnapshot() {
	return withClient(async (client) => {
		const runs = await client.query<{ id: string; raw_output: unknown; brand_mentioned: boolean; competitors_mentioned: string[]; mention_analysis: unknown }>("SELECT id,raw_output,brand_mentioned,competitors_mentioned,mention_analysis FROM prompt_runs WHERE brand_id=$1 ORDER BY id", [MENTION_BRAND]);
		const attempts = await client.query("SELECT id FROM measurement_attempts WHERE brand_id=$1", [MENTION_BRAND]);
		const competitors = await client.query<{ name: string; domains: string[]; aliases: string[] }>("SELECT name,domains,aliases FROM competitors WHERE brand_id=$1 ORDER BY name", [MENTION_BRAND]);
		return { runs: runs.rows, attemptCount: attempts.rowCount, competitors: competitors.rows };
	});
}

export async function closeBrandMentionFixturePool() {
	const { db } = tsRequire("../packages/lib/src/db/db.ts", import.meta.url) as typeof import("../packages/lib/src/db/db");
	await db.$client.end();
}
