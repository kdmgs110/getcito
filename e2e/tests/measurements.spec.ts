import { expect, test } from "@playwright/test";
import { cleanupMeasurementSettingsFixtures, readMeasurementSettingsQueue, seedMeasurementSettingsFixtures, settingsMeasurementTarget, SETTINGS_BRAND, SETTINGS_ENABLED_PROMPTS } from "../measurement-settings-fixtures";
import { PAGE_EVIDENCE_PROMPT, PAGE_EVIDENCE_ATTEMPTS, PAGE_EVIDENCE_URL, PAGE_EVIDENCE_TITLE, PAGE_EVIDENCE_ANSWER, PAGE_EVIDENCE_UNKNOWN_ANSWER, SCRAPER_TARGET, SCRAPER_ATTEMPT, SCRAPER_ANSWER, SCRAPER_QUERY, SCRAPER_SOURCE, AIO_TARGET, AIO_ANSWER, ANSWER_SOURCE, API_ANSWER, cleanupMeasurementFixtures, MEASUREMENT_BRAND, MEASUREMENT_PROMPT, MEASUREMENT_STATUS_PROMPT, OLD_QUERY, OLDER_WEB_ATTEMPT, QUERY_SOURCE, seedMeasurementFixtures, WEB_ANSWER, WEB_ATTEMPT, WEB_QUERY, WEB_TARGET } from "../measurement-fixtures";

test.describe("Existing prompt detail measurement comparison", () => {
 test.describe.configure({mode:"serial"});
 test.beforeAll(seedMeasurementFixtures);
 test.afterAll(cleanupMeasurementFixtures);
 const detail = (promptId=MEASUREMENT_PROMPT) => `/app/${MEASUREMENT_BRAND}/prompts/${promptId}?tab=responses&view=compare&lookback=1m&language=ja`;

 test("compares real Web and Overview records without substituting a newer API answer", async ({page}) => {
  await page.goto(detail());
  const comparison=page.getByTestId("measurement-comparison");
  await expect(comparison).toBeVisible();
  const web=page.getByTestId("measurement-target-chatgpt_web");
  const overview=page.getByTestId("measurement-target-google_ai_overview");
  await expect(web).toContainText(WEB_ANSWER);
  await expect(overview).toContainText(AIO_ANSWER);
  await expect(comparison).not.toContainText(API_ANSWER);
  const citation=web.getByRole("link",{name:/E2E 回答全体の参照元/});
  await expect(citation).toHaveAttribute("href",ANSWER_SOURCE);
  await expect(citation).toHaveAttribute("target","_blank");
  await expect(citation).toHaveAttribute("rel",/noopener/);
  await expect(comparison.locator('a[href^="javascript:"]')).toHaveCount(0);
 });

 test("query drilldown carries exact answer identity and provider-reported URL evidence", async ({page}) => {
  await page.goto(detail());
  const web=page.getByTestId("measurement-target-chatgpt_web");
  await expect(web).toContainText(WEB_ANSWER);
  await web.getByTestId("measurement-queries").click();
  await expect(page).toHaveURL(new RegExp(`attemptId=${WEB_ATTEMPT}`));
  const url=new URL(page.url());
  expect(url.searchParams.get("targetKey")).toBe(WEB_TARGET);
  expect(url.searchParams.get("lookback")).toBe("1m");
  expect(url.searchParams.get("language")).toBe("ja");
  await page.getByText(WEB_QUERY,{exact:true}).click();
  const relation=page.getByRole("link",{name:/E2E クエリに対応する参照元/});
  await expect(relation).toHaveAttribute("href",QUERY_SOURCE);
  await expect(relation).toHaveAttribute("target","_blank");
  await expect(relation).toHaveAttribute("rel",/noopener/);
  await expect(page.getByText("search_queries[0].results",{exact:false})).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.getByText(OLD_QUERY,{exact:true})).toHaveCount(0);
 });

 test("a historical answer opens its own queries rather than the latest answer's queries", async ({page}) => {
  await page.goto(detail());
  const web=page.getByTestId("measurement-target-chatgpt_web");
  await expect(web).toContainText(WEB_ANSWER);
  await web.getByRole("combobox",{name:/回答を選択|Select answer/}).selectOption(OLDER_WEB_ATTEMPT);
  await expect(web).toContainText("E2E ChatGPT Web 過去の回答です。");
  await web.getByTestId("measurement-queries").click();
  await expect(page).toHaveURL(new RegExp(`attemptId=${OLDER_WEB_ATTEMPT}`));
  await expect(page.getByText(OLD_QUERY,{exact:true})).toBeVisible();
  await expect(page.getByText(WEB_QUERY,{exact:true})).toHaveCount(0);
 });

 test("selects scraper answers and preserves their exact query provenance without borrowing BrightData evidence", async ({page}) => {
  await page.goto(detail());
  const web=page.getByTestId("measurement-target-chatgpt_web");
  const source=web.getByRole("combobox",{name:/計測対象|Measurement target/});
  await source.selectOption(SCRAPER_TARGET);
  await expect(web).toContainText(SCRAPER_ANSWER);
  await expect(web).not.toContainText(WEB_ANSWER);
  await web.getByTestId("measurement-queries").click();
  await expect(page).toHaveURL(new RegExp(`attemptId=${SCRAPER_ATTEMPT}`));
  expect(new URL(page.url()).searchParams.get("targetKey")).toBe(SCRAPER_TARGET);
  await page.getByText(SCRAPER_QUERY,{exact:true}).click();
  const queryDetails=page.locator("details").filter({has:page.locator("summary").filter({hasText:SCRAPER_QUERY})});
  await expect(queryDetails).toContainText(/対応は未提供|対応は、取得元から提供されていません|did not expose query-to-URL/);
  // Answer-wide citations are not asserted to be results of the fan-out query.
  await expect(queryDetails.getByRole("link")).toHaveCount(0);
  const answerWideSource=page.getByTestId("page-evidence-table").getByRole("link").filter({hasText:SCRAPER_SOURCE});
  await expect(answerWideSource).toHaveAttribute("href",SCRAPER_SOURCE);
  await expect(page.getByText(WEB_QUERY,{exact:true})).toHaveCount(0);
  await expect(page.getByText(OLD_QUERY,{exact:true})).toHaveCount(0);
  await expect(page.locator(`a[href="${QUERY_SOURCE}"]`)).toHaveCount(0);
 });

 test("a zero-mention visibility answer opens the same exact source in comparison", async ({page}) => {
  const params=new URLSearchParams({model:SCRAPER_TARGET,lookback:"1m",q:"E2E 同じ質問のウェブ回答比較"});
  await page.goto(`/app/${MEASUREMENT_BRAND}/visibility?${params}`);
  await expect(page.getByText(/回答を1件取得済み|1 answers collected/)).toBeVisible();
  await page.getByRole("link",{name:/^回答を表示$|^View answers$/}).click();
  await expect(page.getByTestId("measurement-comparison")).toBeVisible();
  const url=new URL(page.url());
  expect(url.searchParams.get("model")).toBe(SCRAPER_TARGET);
  expect(url.searchParams.get("targetKey")).toBe(SCRAPER_TARGET);
  expect(url.searchParams.get("view")).toBe("compare");
  const web=page.getByTestId("measurement-target-chatgpt_web");
  await expect(web.getByRole("combobox",{name:/計測対象|Measurement target/})).toHaveValue(SCRAPER_TARGET);
  await expect(web).toContainText(SCRAPER_ANSWER);
  await expect(web).not.toContainText(WEB_ANSWER);
 });

 test("an Overview with no answer row remains reachable from the visibility measurement CTA", async ({page}) => {
  const params=new URLSearchParams({model:AIO_TARGET,lookback:"1m",q:"E2E 取得失敗と非表示の区別"});
  await page.goto(`/app/${MEASUREMENT_BRAND}/visibility?${params}`);
  await page.getByRole("link",{name:/^計測結果を表示$|^View measurement results$/}).click();
  expect(new URL(page.url()).searchParams.get("targetKey")).toBe(AIO_TARGET);
  await expect(page.getByTestId("measurement-target-google_ai_overview")).toContainText(/AI Overview非表示|AI Overview not shown/);
 });

 test("an exact answer link cannot cross its recorded language scope", async ({page}) => {
  const params=new URLSearchParams({tab:"web-queries",lookback:"1m",language:"en",attemptId:WEB_ATTEMPT,targetKey:WEB_TARGET});
  await page.goto(`/app/${MEASUREMENT_BRAND}/prompts/${MEASUREMENT_PROMPT}?${params}`);
  await expect(page.getByText(/選択した回答はこの条件では確認できません|selected answer is outside these filters/)).toBeVisible();
  await expect(page.getByText(WEB_QUERY,{exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:/E2E クエリに対応する参照元/})).toHaveCount(0);
 });

 test("counts stored search appearances and citations separately, with provider scope and same-answer denominators", async ({page}) => {
  const params=new URLSearchParams({tab:"web-queries",lookback:"1m",language:"ja",targetKey:SCRAPER_TARGET});
  await page.goto(`/app/${MEASUREMENT_BRAND}/prompts/${PAGE_EVIDENCE_PROMPT}?${params}`);
  const table=page.getByTestId("page-evidence-table");
  await expect(table).toBeVisible();
  await expect(table).toContainText(/検索結果取得 3\/3回答|Search coverage 3\/3 answers/);
  await expect(table).toContainText(/参照元取得 2\/3回答|Source coverage 2\/3 answers/);
  const row=table.getByRole("row").filter({has:page.getByRole("button",{name:PAGE_EVIDENCE_TITLE,exact:true})});
  await expect(row.getByRole("cell").nth(1)).toContainText(/3 \/ 3(?:回答|answers)/);
  await expect(row.getByRole("cell").nth(1)).toContainText(/延べ4件|4 occurrences/);
  await expect(row.getByRole("cell").nth(2)).toContainText(/1 \/ 2(?:回答|answers)/);
  await expect(row.getByRole("cell").nth(3)).toContainText(/1 \/ 2(?:回答|answers)/);
  await expect(row.getByRole("cell").nth(3)).toContainText("50.0%");
  const external=row.getByRole("link");
  await expect(external).toHaveAttribute("href",PAGE_EVIDENCE_URL);
  await expect(external).toHaveAttribute("target","_blank");
  await expect(external).toHaveAttribute("rel",/noopener/);
  await expect(table).not.toContainText("E2E 別プロバイダー専用記事");
  await expect(page.getByText("E2E 別プロバイダー専用検索語",{exact:true})).toHaveCount(0);

  // Pagination displays all 13 URLs without changing their stored totals.
  await expect(table.getByRole("row")).toHaveCount(11);
  await table.getByRole("button",{name:/^次へ$|^Next$/}).click();
  await expect(table.getByRole("row")).toHaveCount(4);
  await table.getByRole("button",{name:/^前へ$|^Previous$/}).click();
  await table.getByRole("button",{name:/^引用あり$|^Cited$/}).click();
  await expect(table.getByRole("row")).toHaveCount(3);

  await table.getByRole("button",{name:/^すべて$|^All$/}).click();
  await table.getByRole("button",{name:/^ドメイン別$|^Domains$/}).click();
  const domain=table.getByRole("row").filter({has:page.getByRole("button",{name:"pages.measurement-test.example.com",exact:true})});
  await expect(domain.getByRole("cell").nth(1)).toContainText(/3 \/ 3(?:回答|answers)/);
  await expect(domain.getByRole("cell").nth(1)).toContainText(/延べ6件|6 occurrences/);
  await expect(domain.getByRole("cell").nth(2)).toContainText(/2 \/ 2(?:回答|answers)/);
  await domain.getByRole("button",{name:/^ページ別$|^Pages$/}).click();
  await expect(table.getByRole("row")).toHaveCount(3);

  // Evidence links resolve one historical answer, not the newest response.
  await row.getByRole("button",{name:PAGE_EVIDENCE_TITLE,exact:true}).click();
  const history=table.getByRole("listitem").filter({hasText:/延べ2件|2 occurrences/});
  await history.getByRole("button",{name:/LLMの回答を見る|View LLM answer/}).click();
  const answerUrl=new URL(page.url());
  expect(answerUrl.searchParams.get("attemptId")).toBe(PAGE_EVIDENCE_ATTEMPTS[0]);
  expect(answerUrl.searchParams.get("targetKey")).toBe(SCRAPER_TARGET);
  await expect(page.getByText(PAGE_EVIDENCE_ANSWER,{exact:false})).toBeVisible();
 });

 test("uses BrightData array-wrapped saved evidence when the selected provider changes", async ({page}) => {
  const params=new URLSearchParams({tab:"web-queries",lookback:"1m",language:"ja",targetKey:SCRAPER_TARGET});
  await page.goto(`/app/${MEASUREMENT_BRAND}/prompts/${PAGE_EVIDENCE_PROMPT}?${params}`);
  const table=page.getByTestId("page-evidence-table");
  await expect(table).toContainText(PAGE_EVIDENCE_TITLE);
  await page.getByRole("combobox",{name:/^計測対象$|^Measurement target$/}).selectOption(WEB_TARGET);
  await expect.poll(() => new URL(page.url()).searchParams.get("targetKey")).toBe(WEB_TARGET);
  await expect(table).toContainText(/検索結果取得 1\/1回答|Search coverage 1\/1 answers/);
  await expect(table).toContainText(/参照元取得 1\/1回答|Source coverage 1\/1 answers/);
  await expect(table).not.toContainText(PAGE_EVIDENCE_TITLE);
  const row=table.getByRole("row").filter({has:page.getByRole("button",{name:"E2E 別プロバイダー専用記事",exact:true})});
  await expect(row.getByRole("cell").nth(1)).toContainText(/1 \/ 1(?:回答|answers)/);
  await expect(row.getByRole("cell").nth(2)).toContainText(/1 \/ 1(?:回答|answers)/);
  await expect(row.getByRole("cell").nth(3)).toContainText("100.0%");
  await expect(row.getByRole("link")).toHaveAttribute("href","https://other.measurement-test.example.com/");
  await expect(page.getByText("E2E 別プロバイダー専用検索語",{exact:true})).toBeVisible();
  await expect(page.getByText("E2E ページ集計 検索語 1",{exact:true})).toHaveCount(0);
 });

 test("keeps a missing source list unknown and excludes it from search-only classification", async ({page}) => {
  const params=new URLSearchParams({tab:"web-queries",lookback:"1m",language:"ja",targetKey:SCRAPER_TARGET,attemptId:PAGE_EVIDENCE_ATTEMPTS[2]});
  await page.goto(`/app/${MEASUREMENT_BRAND}/prompts/${PAGE_EVIDENCE_PROMPT}?${params}`);
  const table=page.getByTestId("page-evidence-table");
  await expect(table).toContainText(/参照元取得 0\/1回答|Source coverage 0\/1 answers/);
  const row=table.getByRole("row").filter({has:page.getByRole("button",{name:PAGE_EVIDENCE_TITLE,exact:true})});
  await expect(row.getByRole("cell").nth(1)).toContainText(/1 \/ 1(?:回答|answers)/);
  await expect(row.getByRole("cell").nth(2)).toHaveText(/未提供|Not provided/);
  await expect(row.getByRole("cell").nth(3)).toHaveText("—");
  await table.getByRole("button",{name:/^検索結果のみ$|^Search results only$/}).click();
  await expect(table.getByRole("row")).toHaveCount(1);
  await expect(table).toContainText(/この条件に一致するページはありません|No pages match/);
 });

 test("keeps acquisition failure distinct from a successful Overview-not-shown result", async ({page}) => {
  await page.goto(detail(MEASUREMENT_STATUS_PROMPT));
  await expect(page.getByTestId("measurement-target-chatgpt_web")).toContainText(/取得失敗|Failed/);
  const overview=page.getByTestId("measurement-target-google_ai_overview");
  await expect(overview).toContainText(/AI Overview非表示|AI Overview not shown/);
  // Explanatory prose and the original question may mention failure. Assert
  // the status label itself, rather than forbidding that word everywhere.
  await expect(overview.getByText(/^(取得失敗|Failed)$/)).toHaveCount(0);
  await expect(overview).toContainText(/検索なしを意味するものではありません|does not mean that no search occurred/);
 });
});


test.describe("Measurement settings enqueue immediate real jobs", () => {
 test.beforeAll(seedMeasurementSettingsFixtures);
 test.afterAll(cleanupMeasurementSettingsFixtures);

 test("queues newly enabled targets once for enabled prompts and does not queue unchanged or empty selections", async ({page}) => {
  const target=settingsMeasurementTarget();
  await page.goto(`/app/${SETTINGS_BRAND}/settings/llms`);
  const checkbox=page.locator(`[id="target-${target}"]`);
  const save=page.getByRole("button",{name:/^計測対象を保存$|^Save targets$/});
  await expect(checkbox).not.toBeChecked();
  await expect.poll(async () => (await readMeasurementSettingsQueue()).jobs.length).toBe(0);
  await checkbox.check();
  await save.click();
  await expect(page.getByRole("status")).toContainText(/2.*(?:プロンプト|prompts)/);
  await expect.poll(async () => (await readMeasurementSettingsQueue()).jobs.length).toBe(2);
  const queued=await readMeasurementSettingsQueue();
  expect(queued.enabled_targets).toEqual([target]);
  expect(queued.jobs.map((job) => job.data.promptId).sort()).toEqual([...SETTINGS_ENABLED_PROMPTS].sort());
  const batchId=queued.jobs[0].data.measurementBatchId;
  expect(batchId).toMatch(/^[0-9a-f-]{36}$/i);
  for (const job of queued.jobs) {
   expect(job).toMatchObject({priority:100,state:"created",immediate:true});
   expect(job.data).toMatchObject({singleRun:true,settingsChange:true,targetKeys:[target],measurementBatchId:batchId});
  }
  const jobIds=queued.jobs.map((job) => job.id);

  // An identical save may persist settings, but must not duplicate jobs or runs.
  await save.click();
  await expect(page.getByRole("status")).toContainText(/計測対象を保存しました|Measurement targets saved/);
  expect((await readMeasurementSettingsQueue()).jobs.map((job) => job.id)).toEqual(jobIds);

  await checkbox.uncheck();
  await save.click();
  await expect(page.getByRole("status")).toContainText(/計測対象を保存しました|Measurement targets saved/);
  const disabled=await readMeasurementSettingsQueue();
  expect(disabled.enabled_targets).toEqual([]);
  expect(disabled.jobs.map((job) => job.id)).toEqual(jobIds);
  // CI has no worker: queued jobs remain unexecuted and no provider attempt occurs.
  expect(disabled.runs).toBe(0);
  expect(disabled.attempts).toBe(0);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
 });
});
