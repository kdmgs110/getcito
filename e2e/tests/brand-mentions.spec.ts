import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
	MENTION_AI_RUN, MENTION_AI_TARGET, MENTION_BRAND, MENTION_CANDIDATE, MENTION_CHAT_RUN,
	MENTION_COMPETITOR, MENTION_NO_ANSWER_ATTEMPT, MENTION_OLD_ALIAS, MENTION_OLD_RUN, MENTION_OWN, MENTION_PROMPT, MENTION_TARGET,
	brandMentionSnapshot, cleanupBrandMentionFixtures, closeBrandMentionFixturePool,
	completeBrandMentionRecount, failBrandMentionRecount, seedBrandMentionFixtures,
} from "../brand-mentions-fixtures";

const spreadsheetPath = `/app/${MENTION_BRAND}/visibility?${new URLSearchParams({ model: MENTION_TARGET, lookback: "1m", view: "spreadsheet" })}`;
const detailPath = (search: Record<string, string> = {}) => `/app/${MENTION_BRAND}/prompts/${MENTION_PROMPT}?${new URLSearchParams({ model: MENTION_TARGET, lookback: "1m", ...search })}`;

async function csvText(page: Page) {
	const downloaded = page.waitForEvent("download");
	await page.getByRole("button", { name: "この表をCSV出力", exact: true }).click();
	const path = await (await downloaded).path();
	if (!path) throw new Error("CSV file missing");
	return readFile(path, "utf8");
}

test.describe("Brand positions and historical recount", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeEach(seedBrandMentionFixtures);
	test.afterEach(cleanupBrandMentionFixtures);
	test.afterAll(closeBrandMentionFixturePool);

	test("keeps own, competitor and unregistered positions in a single cell and exposes source evidence", async ({ page }) => {
		await page.goto(spreadsheetPath);
		const brands = page.getByTestId(`brand-mentions-${MENTION_CHAT_RUN}`);
		await expect(brands).toContainText("回答内順位");
		const items = brands.getByRole("listitem");
		await expect(items).toHaveCount(3);
		await expect(items.nth(0)).toContainText(`1位${MENTION_COMPETITOR}競合`);
		await expect(items.nth(1)).toContainText(`2位${MENTION_OWN}自社`);
		await expect(items.nth(2)).toContainText(`3位${MENTION_CANDIDATE}未登録`);
		await expect(brands.getByRole("button", { name: /を登録$/ })).toHaveCount(1);
		await brands.getByRole("button", { name: "根拠を見る", exact: true }).click();
		await expect(page.getByRole("dialog")).toContainText(`1. ${MENTION_COMPETITOR}`);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("registers a candidate, recounts stored answers, retains its rank and exports positions without acquiring again", async ({ page }) => {
		const before = await brandMentionSnapshot();
		await page.goto(spreadsheetPath);
		const brands = page.getByTestId(`brand-mentions-${MENTION_CHAT_RUN}`);
		await brands.getByRole("button", { name: `${MENTION_CANDIDATE}を登録`, exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "ブランドを登録", exact: true });
		await expect(dialog.getByLabel("ブランド名 *", { exact: true })).toHaveValue(MENTION_CANDIDATE);
		await dialog.getByLabel("公式ドメイン（任意）", { exact: true }).fill("new.brand-mentions.example.com");
		await dialog.getByRole("button", { name: "登録して過去回答を再集計", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByTestId("mention-recount-status")).toContainText("再集計の開始を待っています");
		await completeBrandMentionRecount();
		await expect(page.getByTestId("mention-recount-status")).toContainText("再集計が完了しました", { timeout: 20_000 });
		await expect(brands.getByRole("listitem").nth(2)).toContainText(`3位${MENTION_CANDIDATE}競合`);
		await expect(brands.getByRole("button", { name: `${MENTION_CANDIDATE}を登録`, exact: true })).toHaveCount(0);
		const csv = await csvText(page);
		expect(csv).toContain(`3位 | ${MENTION_CANDIDATE} | 競合 | 回答内順位`);
		expect(csv).toContain(`2位 | ${MENTION_OWN} | 自社 | 回答内順位`);
		expect(csv).toContain("AIモードの言及ブランド・順位");
		const after = await brandMentionSnapshot();
		expect(after.competitors.filter((competitor) => competitor.name === MENTION_CANDIDATE)).toHaveLength(1);
		expect(after.runs.map((run) => [run.id, run.raw_output])).toEqual(before.runs.map((run) => [run.id, run.raw_output]));
		expect(after.attemptCount).toBe(before.attemptCount);
		expect(after.runs).toHaveLength(before.runs.length);
		expect(after.runs.every((run) => run.mention_analysis !== null)).toBe(true);
	});

	test("attaches a name to the own brand from prompt detail and corrects historical mention flags", async ({ page }) => {
		await page.goto(detailPath({ tab: "responses", runId: MENTION_OLD_RUN, targetKey: MENTION_TARGET }));
		const brands = page.getByTestId(`brand-mentions-${MENTION_OLD_RUN}`);
		await expect(brands).toContainText(MENTION_OLD_ALIAS);
		await brands.getByRole("button", { name: `${MENTION_OLD_ALIAS}を登録`, exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "ブランドを登録", exact: true });
		await dialog.getByRole("radio", { name: "登録済みブランドの別名として追加", exact: true }).check();
		await dialog.getByLabel("紐づけるブランド", { exact: true }).selectOption("own");
		await dialog.getByRole("button", { name: "登録して過去回答を再集計", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await completeBrandMentionRecount();
		await expect(page.getByTestId("mention-recount-status")).toContainText("再集計が完了しました", { timeout: 20_000 });
		await expect(brands.getByRole("listitem").first()).toContainText(`1位${MENTION_OWN}自社`);
		const snapshot = await brandMentionSnapshot();
		expect(snapshot.runs.find((run) => run.id === MENTION_OLD_RUN)?.brand_mentioned).toBe(true);
		await page.goto(detailPath());
		await expect(page.getByRole("region", { name: "言及されたブランド", exact: true })).toContainText(MENTION_OWN);
	});

	test("scopes detail brands to the selected run or AI model instead of mixing answer positions", async ({ page }) => {
		await page.goto(detailPath());
		await expect(page.getByTestId(`brand-mentions-${MENTION_CHAT_RUN}`)).toBeVisible();
		await expect(page.getByTestId(`brand-mentions-${MENTION_OLD_RUN}`)).toHaveCount(0);
		await page.goto(detailPath({ runId: MENTION_OLD_RUN, targetKey: MENTION_TARGET }));
		await expect(page.getByTestId(`brand-mentions-${MENTION_OLD_RUN}`)).toContainText(MENTION_OLD_ALIAS);
		await expect(page.getByTestId(`brand-mentions-${MENTION_CHAT_RUN}`)).toHaveCount(0);
		await page.goto(detailPath({ model: MENTION_AI_TARGET, targetKey: MENTION_AI_TARGET }));
		await expect(page.getByTestId(`brand-mentions-${MENTION_AI_RUN}`)).toContainText(`1位${MENTION_OWN}自社`);
		await expect(page.getByTestId(`brand-mentions-${MENTION_CHAT_RUN}`)).toHaveCount(0);
		await page.goto(detailPath({ model: MENTION_AI_TARGET, targetKey: MENTION_AI_TARGET, attemptId: MENTION_NO_ANSWER_ATTEMPT }));
		await expect(page.getByRole("region", { name: "言及されたブランド", exact: true })).toContainText("期間内の回答なし");
		await expect(page.getByTestId(`brand-mentions-${MENTION_AI_RUN}`)).toHaveCount(0);
	});

	test("keeps the registration after a recount failure and lets the user retry", async ({ page }) => {
		await page.goto(spreadsheetPath);
		await page.getByTestId(`brand-mentions-${MENTION_CHAT_RUN}`).getByRole("button", { name: "ブランド名を入力して追加", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "ブランドを登録", exact: true });
		await dialog.getByLabel("ブランド名 *", { exact: true }).fill("E2E Manual Brand");
		await dialog.getByRole("button", { name: "登録して過去回答を再集計", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await failBrandMentionRecount();
		await expect(page.getByTestId("mention-recount-status")).toContainText("登録内容は保存されています", { timeout: 20_000 });
		await page.getByRole("button", { name: "再集計を再試行", exact: true }).click();
		await expect(page.getByTestId("mention-recount-status")).toContainText("再集計の開始を待っています");
		await completeBrandMentionRecount();
		await expect(page.getByTestId("mention-recount-status")).toContainText("再集計が完了しました", { timeout: 20_000 });
		const snapshot = await brandMentionSnapshot();
		expect(snapshot.competitors.filter((competitor) => competitor.name === "E2E Manual Brand")).toHaveLength(1);
	});
});
