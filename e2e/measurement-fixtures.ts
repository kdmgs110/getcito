/** Deterministic evidence fixtures; never call a provider or mutate a live database. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TEST_USER } from "./seed";
import { testDatabaseUrl } from "./test-database";

export const MEASUREMENT_BRAND = "brand-measurements-e2e";
export const MEASUREMENT_PROMPT = "00000000-0000-4000-8000-550000000001";
export const MEASUREMENT_STATUS_PROMPT = "00000000-0000-4000-8000-550000000002";
export const WEB_TARGET = "chatgpt:brightdata:online";
export const SCRAPER_TARGET = "chatgpt:dataforseo-scraper:online";
export const SCRAPER_ATTEMPT = "00000000-0000-4000-8000-550000000013";
export const SCRAPER_ANSWER = "E2E DataForSEO ChatGPT Web 言及なしの回答です。";
export const SCRAPER_QUERY = "E2E DataForSEO 実行専用 ファンアウト検索語";
export const SCRAPER_SOURCE = "https://measurement-test.example.com/scraper-answer-source";
export const AIO_TARGET = "google-ai-overview:brightdata:online";
export const WEB_ATTEMPT = "00000000-0000-4000-8000-550000000011";
export const OLDER_WEB_ATTEMPT = "00000000-0000-4000-8000-550000000012";
export const WEB_ANSWER = "E2E ChatGPT Web 日本語の最新回答です。";
export const AIO_ANSWER = "E2E AI Overview 日本語の回答です。";
export const API_ANSWER = "E2E API ANSWER MUST NEVER APPEAR IN WEB COMPARISON";
export const WEB_QUERY = "E2E 日本語 最新 検索クエリ";
export const OLD_QUERY = "E2E 過去回答 専用検索クエリ";
export const AIO_QUERY = "E2E Overview 専用検索クエリ";
export const QUERY_SOURCE = "https://measurement-test.example.com/query-source";
export const ANSWER_SOURCE = "https://measurement-test.example.com/answer-source";

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
 const url = testDatabaseUrl();
 if (!new URL(url).pathname.includes("test")) throw new Error("Measurement fixtures require a dedicated test database");
 const client = new pg.Client({connectionString:url});
 await client.connect();
 try { return await run(client); } finally { await client.end(); }
}

export async function cleanupMeasurementFixtures() {
 await withClient(async (client) => {
  await client.query("DELETE FROM measurement_attempts WHERE brand_id=$1", [MEASUREMENT_BRAND]);
  await client.query("DELETE FROM citations WHERE brand_id=$1", [MEASUREMENT_BRAND]);
  await client.query("DELETE FROM prompt_runs WHERE brand_id=$1", [MEASUREMENT_BRAND]);
  await client.query("DELETE FROM prompts WHERE brand_id=$1", [MEASUREMENT_BRAND]);
  await client.query("DELETE FROM brands WHERE id=$1", [MEASUREMENT_BRAND]);
  await client.query("DELETE FROM organization WHERE id=$1", [MEASUREMENT_BRAND]);
 });
}

export async function seedMeasurementFixtures() {
 await cleanupMeasurementFixtures();
 await withClient(async (client) => {
  await client.query("BEGIN");
  try {
   const users = await client.query('SELECT id FROM "user" WHERE email=$1', [TEST_USER.email]);
   if (!users.rows[0]) throw new Error("Measurement fixture user must be authenticated first");
   await client.query("INSERT INTO organization(id,name,slug,created_at) VALUES($1,'E2E 計測比較',$1,NOW())", [MEASUREMENT_BRAND]);
   await client.query("INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'admin',NOW())", [randomUUID(),MEASUREMENT_BRAND,users.rows[0].id]);
   // Disabled scheduling guarantees browser tests cannot trigger paid measurement.
   await client.query("INSERT INTO brands(id,name,website,enabled,onboarded,enabled_targets,target_language,target_market) VALUES($1,'E2E 計測比較','https://measurement-test.example.com/',false,true,$2,'Japanese','Japan')", [MEASUREMENT_BRAND,[WEB_TARGET,AIO_TARGET]]);
   for (const [id,value] of [[MEASUREMENT_PROMPT,"E2E 同じ質問のウェブ回答比較"],[MEASUREMENT_STATUS_PROMPT,"E2E 取得失敗と非表示の区別"]]) {
    await client.query("INSERT INTO prompts(id,brand_id,value,enabled) VALUES($1,$2,$3,true)", [id,MEASUREMENT_BRAND,value]);
   }
   const context = {version:1,prompt:"E2E 同じ質問のウェブ回答比較",targetLanguage:"Japanese",targetMarket:"Japan",languageCode:"ja",countryCode:"jp"};
   for (const [attemptId,model,provider,target,answer,query,minutes] of [
    [OLDER_WEB_ATTEMPT,"chatgpt","brightdata",WEB_TARGET,"E2E ChatGPT Web 過去の回答です。",OLD_QUERY,30],
    [WEB_ATTEMPT,"chatgpt","brightdata",WEB_TARGET,WEB_ANSWER,WEB_QUERY,10],
    [randomUUID(),"google-ai-overview","brightdata",AIO_TARGET,AIO_ANSWER,AIO_QUERY,9],
    [SCRAPER_ATTEMPT,"chatgpt","dataforseo-scraper",SCRAPER_TARGET,SCRAPER_ANSWER,SCRAPER_QUERY,8],
    [randomUUID(),"chatgpt","openai-api","chatgpt:openai-api:gpt-5:online",API_ANSWER,"E2E API QUERY MUST NOT LEAK",1],
   ] as const) {
    const runId = randomUUID();
    const isScraper = provider === "dataforseo-scraper";
    // Scraper exposes actual queries, but no query-to-source relationships.
    const evidence = {version:1,answerText:answer,answerStatus:"shown",queryStatus:"observed",queryEvidence:isScraper ? [] : [{query,sourceField:"search_queries[0].results",urls:[{url:QUERY_SOURCE,title:"E2E クエリに対応する参照元",role:"search_result"},{url:"javascript:alert(1)",title:"E2E unsafe query URL",role:"unknown"}]}]};
    const rawOutput = isScraper ? {tasks:[{result:[{markdown:answer,fan_out_queries:[query],sources:[{url:SCRAPER_SOURCE}]}]}]} : {answer};
    await client.query(`INSERT INTO prompt_runs(id,prompt_id,brand_id,model,provider,version,web_search_enabled,raw_output,brand_mentioned,web_queries,request_context,created_at)
     VALUES($1,$2,$3,$4,$5,'upstream-returned-version',true,$6::json,$10,$7,$8::jsonb,NOW()-$9*INTERVAL '1 minute')`, [runId,MEASUREMENT_PROMPT,MEASUREMENT_BRAND,model,provider,JSON.stringify(rawOutput),[query],JSON.stringify(context),minutes,!isScraper]);
    await client.query(`INSERT INTO measurement_attempts(id,batch_id,brand_id,prompt_id,target_key,model,provider,status,web_search_enabled,request_context,evidence,prompt_run_id,created_at,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'succeeded',true,$8::jsonb,$9::jsonb,$10,NOW()-$11*INTERVAL '1 minute',NOW()-$11*INTERVAL '1 minute')`, [attemptId,randomUUID(),MEASUREMENT_BRAND,MEASUREMENT_PROMPT,target,model,provider,JSON.stringify(context),JSON.stringify(evidence),runId,minutes]);
    for (const [url,title] of [[isScraper ? SCRAPER_SOURCE : ANSWER_SOURCE,"E2E 回答全体の参照元"],["javascript:alert(1)","E2E unsafe citation"]]) {
     await client.query("INSERT INTO citations(prompt_run_id,prompt_id,brand_id,model,url,domain,title,citation_index,created_at) VALUES($1,$2,$3,$4,$5,'measurement-test.example.com',$6,1,NOW())", [runId,MEASUREMENT_PROMPT,MEASUREMENT_BRAND,model,url,title]);
    }
   }
   for (const [model,target,status,evidence] of [
    ["chatgpt",WEB_TARGET,"failed",null],
    ["google-ai-overview",AIO_TARGET,"succeeded",{version:1,answerText:"",answerStatus:"not_shown",queryStatus:"not_exposed",queryEvidence:[]}],
   ] as const) {
    await client.query(`INSERT INTO measurement_attempts(batch_id,brand_id,prompt_id,target_key,model,provider,status,web_search_enabled,request_context,evidence,completed_at)
     VALUES($1,$2,$3,$4,$5,'brightdata',$6,true,$7::jsonb,$8::jsonb,NOW())`,[randomUUID(),MEASUREMENT_BRAND,MEASUREMENT_STATUS_PROMPT,target,model,status,JSON.stringify({...context,prompt:"E2E 取得失敗と非表示の区別"}),evidence?JSON.stringify(evidence):null]);
   }
   await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
 });
}
