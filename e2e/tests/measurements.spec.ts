import { expect, test } from "@playwright/test";
import { cleanupMeasurementSettingsFixtures, readMeasurementSettingsQueue, seedMeasurementSettingsFixtures, settingsMeasurementTarget, SETTINGS_BRAND, SETTINGS_ENABLED_PROMPTS } from "../measurement-settings-fixtures";
import { SCRAPER_TARGET, SCRAPER_ATTEMPT, SCRAPER_ANSWER, SCRAPER_QUERY, SCRAPER_SOURCE, AIO_TARGET, AIO_ANSWER, ANSWER_SOURCE, API_ANSWER, cleanupMeasurementFixtures, MEASUREMENT_BRAND, MEASUREMENT_PROMPT, MEASUREMENT_STATUS_PROMPT, OLD_QUERY, OLDER_WEB_ATTEMPT, QUERY_SOURCE, seedMeasurementFixtures, WEB_ANSWER, WEB_ATTEMPT, WEB_QUERY, WEB_TARGET } from "../measurement-fixtures";

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
  await expect(queryDetails).toContainText(/対応は、取得元から提供されていません|did not expose pages associated/);
  // Answer-wide citations are not asserted to be results of the fan-out query.
  await expect(queryDetails.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("link",{name:/E2E 回答全体の参照元/})).toHaveAttribute("href",SCRAPER_SOURCE);
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
  await expect(page.getByRole("alert")).toContainText(/この期間・言語では|outside this period or language/);
  await expect(page.getByText(WEB_QUERY,{exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:/E2E クエリに対応する参照元/})).toHaveCount(0);
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
