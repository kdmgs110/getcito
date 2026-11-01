import { expect, test } from "@playwright/test";
import { AIO_ANSWER, ANSWER_SOURCE, API_ANSWER, cleanupMeasurementFixtures, MEASUREMENT_BRAND, MEASUREMENT_PROMPT, MEASUREMENT_STATUS_PROMPT, OLD_QUERY, OLDER_WEB_ATTEMPT, QUERY_SOURCE, seedMeasurementFixtures, WEB_ANSWER, WEB_ATTEMPT, WEB_QUERY, WEB_TARGET } from "../measurement-fixtures";

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
