/** Isolated, local-only visibility fixtures. No worker or provider request is needed. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TEST_USER } from "./seed";
import { testDatabaseUrl } from "./test-database";

export const VISIBILITY_BRAND = "brand-visibility-e2e";
export const VISIBILITY_TARGET = "chatgpt:dataforseo-scraper:online";
export const VISIBILITY_COUNT = 26;
export const VISIBILITY_TAG = "一覧テスト";
export const VISIBILITY_FORMULA = '=E2E CSV, "引用"\n改行';
export const VISIBILITY_ANSWER = 'E2E 一覧の回答です。CSVのカンマ, と "引用符"、\n改行を保持します。';
export const VISIBILITY_FULL_ANSWER = `${VISIBILITY_ANSWER}\nE2E 表示状況とE2E 比較ブランドをご紹介します。\n${"回答の全文が長い場合も省略せずCSVへ出力します。".repeat(30)}\nE2E 全文の終端`;
export const VISIBILITY_AI_ANSWER = "E2E Google AIモードの回答です。ChatGPTとは別の結果を確認できます。";
export const VISIBILITY_QUERY = "E2E Rails フルリモート 高単価";
export const VISIBILITY_PAGE_A = "https://evidence.visibility.example.com/rails-a";
export const VISIBILITY_PAGE_B = "https://evidence.visibility.example.com/rails-b";

export const visibilityPromptId = (number: number) => `00000000-0000-4000-8000-5800000000${String(number).padStart(2, "0")}`;
export const visibilityPromptValue = (number: number) => number === 26 ? VISIBILITY_FORMULA : `E2E 一覧 ${String(number).padStart(2, "0")}`;

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
	const url = testDatabaseUrl();
	if (!new URL(url).pathname.includes("test")) throw new Error("Visibility fixtures require a dedicated test database");
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try { return await run(client); } finally { await client.end(); }
}

export async function cleanupVisibilityFixtures() {
	await withClient(async (client) => {
		for (const table of ["measurement_attempts", "citations", "prompt_runs", "prompts", "competitors"]) {
			await client.query(`DELETE FROM ${table} WHERE brand_id=$1`, [VISIBILITY_BRAND]);
		}
		await client.query("DELETE FROM brands WHERE id=$1", [VISIBILITY_BRAND]);
		await client.query("DELETE FROM organization WHERE id=$1", [VISIBILITY_BRAND]);
	});
}

export async function seedVisibilityFixtures() {
	await cleanupVisibilityFixtures();
	await withClient(async (client) => {
		await client.query("BEGIN");
		try {
			const user = await client.query('SELECT id FROM "user" WHERE email=$1', [TEST_USER.email]);
			if (!user.rows[0]) throw new Error("Authenticate the fixture user before seeding visibility data");
			await client.query("INSERT INTO organization(id,name,slug,created_at) VALUES($1,'E2E 表示状況',$1,NOW())", [VISIBILITY_BRAND]);
			await client.query("INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'admin',NOW())", [randomUUID(), VISIBILITY_BRAND, user.rows[0].id]);
			await client.query("INSERT INTO brands(id,name,website,enabled,onboarded,enabled_targets,target_language,target_market) VALUES($1,'E2E 表示状況','https://visibility.example.com',false,true,$2,'Japanese','Japan')", [VISIBILITY_BRAND, [VISIBILITY_TARGET, "google-ai-mode:dataforseo:online"]]);
			await client.query("INSERT INTO competitors(id,brand_id,name,domains) VALUES($1,$2,'E2E 比較ブランド',$3)", [randomUUID(), VISIBILITY_BRAND, ["competitor.visibility.example.com"]]);
			for (let number = 1; number <= VISIBILITY_COUNT; number++) {
				const promptId = visibilityPromptId(number);
				const prompt = visibilityPromptValue(number);
				const tags = [VISIBILITY_TAG, number % 2 ? "フルリモート" : "週3日", ...(number === 1 ? ["高単価"] : [])];
				await client.query("INSERT INTO prompts(id,brand_id,value,enabled,tags,system_tags) VALUES($1,$2,$3,true,$4,$5)", [promptId, VISIBILITY_BRAND, prompt, tags, ["unbranded"]]);
				if (number === 26) continue; // A prompt without a run must remain visible/exportable.
				const context = { version: 1, prompt, targetLanguage: "Japanese", targetMarket: "Japan", languageCode: "ja", countryCode: "jp" };
				for (const aiMode of number === 1 ? [false, true] : [false]) {
					const runId = randomUUID();
					const model = aiMode ? "google-ai-mode" : "chatgpt";
					const provider = aiMode ? "dataforseo" : "dataforseo-scraper";
					const target = aiMode ? "google-ai-mode:dataforseo:online" : VISIBILITY_TARGET;
					const answer = aiMode ? VISIBILITY_AI_ANSWER : number === 1 ? VISIBILITY_FULL_ANSWER : `${VISIBILITY_ANSWER}\nプロンプト番号 ${number}`;
					const queries = number === 24 || number === 25 ? [] : [VISIBILITY_QUERY, `E2E 検索語 ${number}`];
					const pages = [{ url: VISIBILITY_PAGE_A, title: "E2E Rails 記事A" }, { url: VISIBILITY_PAGE_B, title: "E2E Rails 記事B" }];
					const result = { markdown: answer, fan_out_queries: queries, search_results: number === 25 ? null : number === 24 ? [] : [pages[0], pages[0], pages[1]], sources: number === 25 ? null : number === 24 ? [] : [pages[0]] };
					const pageEvidenceItems = pages.map((page) => ({ ...page, key: page.url, domain: "evidence.visibility.example.com", displayDomain: "evidence.visibility.example.com", sourceField: "e2e" }));
					const evidence = { version: 1, answerText: answer, answerStatus: "shown", queryStatus: number === 25 ? "not_exposed" : "observed", queryEvidence: [], pageEvidence: { version: 1, search: { status: number === 25 ? "unknown" : "known", sourceField: "e2e", items: number >= 24 ? [] : [pageEvidenceItems[0], pageEvidenceItems[0], pageEvidenceItems[1]] }, citations: { status: number === 25 ? "unknown" : "known", sourceField: "e2e", items: number >= 24 ? [] : [pageEvidenceItems[0]] } } };
					await client.query(`INSERT INTO prompt_runs(id,prompt_id,brand_id,model,provider,version,web_search_enabled,raw_output,web_queries,brand_mentioned,competitors_mentioned,request_context,created_at)
						VALUES($1,$2,$3,$4,$5,'e2e',true,$6::json,$7,true,$8,$9::jsonb,NOW()-INTERVAL '5 minutes')`, [runId, promptId, VISIBILITY_BRAND, model, provider, JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [result] }] }), queries, ["E2E 比較ブランド"], JSON.stringify(context)]);
					await client.query(`INSERT INTO measurement_attempts(id,batch_id,brand_id,prompt_id,target_key,model,provider,status,web_search_enabled,request_context,evidence,prompt_run_id,created_at,completed_at)
						VALUES($1,$2,$3,$4,$5,$6,$7,'succeeded',true,$8::jsonb,$9::jsonb,$10,NOW()-INTERVAL '5 minutes',NOW()-INTERVAL '5 minutes')`, [randomUUID(), randomUUID(), VISIBILITY_BRAND, promptId, target, model, provider, JSON.stringify(context), JSON.stringify(evidence), runId]);
					if (number !== 24 && number !== 25) await client.query("INSERT INTO citations(prompt_run_id,prompt_id,brand_id,model,url,domain,title,citation_index,created_at) VALUES($1,$2,$3,$4,$5,'evidence.visibility.example.com','E2E Rails 記事A',0,NOW()-INTERVAL '5 minutes')", [runId, promptId, VISIBILITY_BRAND, model, VISIBILITY_PAGE_A]);
				}
			}
			await client.query("COMMIT");
		} catch (error) { await client.query("ROLLBACK"); throw error; }
	});
}
