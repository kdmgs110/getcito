import { expect, test } from "@playwright/test";
import {
	CONVERSION_BRAND_ID,
	CONVERSION_FROM,
	CONVERSION_GOAL_ID,
	CONVERSION_TO,
	readConversionFixtureState,
	seedConversionFixtures,
} from "../conversion-fixtures";

const ja = !process.env.VITE_APP_LOCALE || /^ja(?:-|$)/i.test(process.env.VITE_APP_LOCALE);
const text = (japanese: string, english: string) => (ja ? japanese : english);
const path = `/app/${CONVERSION_BRAND_ID}/traffic?from=${CONVERSION_FROM}&to=${CONVERSION_TO}&analysisTab=conversions`;

test.describe("AI conversions", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeEach(async () => {
		await seedConversionFixtures();
	});

	test("distinguishes repeat events from converting sessions, switches grain and opens page trends", async ({
		page,
	}) => {
		await page.goto(path);
		await expect(page.getByRole("combobox", { name: text("対象CV", "Conversion"), exact: true })).toHaveValue(
			CONVERSION_GOAL_ID,
		);
		const period = page.locator("section").filter({
			has: page.getByRole("heading", { name: text("期間別のコンバージョン", "Conversions by period"), exact: true }),
		});
		await expect(period.locator("tbody tr")).toHaveCount(28);
		const totals = period.locator("tfoot tr");
		await expect(totals.locator("td")).toHaveText(["112", "280", "56", "10.00%"]);
		// Four events from twenty sessions is not the two converting sessions / twenty (10%).
		await expect(
			page.getByText(`${text("AI CVセッション", "AI converting sessions")}: 56`, { exact: true }),
		).toBeVisible();
		await page.getByRole("tab", { name: text("月別", "Monthly"), exact: true }).click();
		await expect(period.locator("tbody tr")).toHaveCount(1);
		await expect(totals.locator("td")).toHaveText(["112", "280", "56", "10.00%"]);
		await page.getByRole("tab", { name: text("週別", "Weekly"), exact: true }).click();
		await expect(period.locator("tbody tr")).toHaveCount(5);
		await page.getByRole("button", { name: `${text("推移を見る", "View trend")}: /`, exact: true }).click();
		const detail = page.getByRole("dialog");
		await expect(
			detail.getByRole("heading", { name: text("ページ別のCV推移", "Conversion trend for this page"), exact: true }),
		).toBeVisible();
		await expect(detail.getByText("112", { exact: true }).first()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(detail).toBeHidden();
		await expect(page).not.toHaveURL(/detail=/);
	});

	test("persists a conversion view and restores its goal, tab and dates", async ({ page }) => {
		await page.goto(path);
		await expect(page.getByText("112", { exact: true }).first()).toBeVisible();
		await page.getByRole("button", { name: text("登録", "Register"), exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel(text("登録名", "View name"), { exact: true }).fill("応募CVチェック");
		await dialog.getByRole("button", { name: text("登録して表示", "Save and display"), exact: true }).click();
		await expect(page.getByRole("tab", { name: "応募CVチェック", exact: true })).toHaveAttribute(
			"data-state",
			"active",
		);
		const state = await readConversionFixtureState();
		expect(state.views.find((view) => view.name === "応募CVチェック")).toMatchObject({
			analysis_tab: "conversions",
			conversion_goal_id: CONVERSION_GOAL_ID,
			conditions: [],
		});
		await page.getByRole("tab", { name: text("流入", "Traffic"), exact: true }).click();
		await page.getByRole("tab", { name: "トップページCV", exact: true }).click();
		await expect(page.getByRole("tab", { name: text("コンバージョン", "Conversions"), exact: true })).toHaveAttribute(
			"data-state",
			"active",
		);
		await page.reload();
		await expect(page.getByRole("combobox", { name: text("対象CV", "Conversion"), exact: true })).toHaveValue(
			CONVERSION_GOAL_ID,
		);
		await expect(page.getByLabel(text("開始日", "From"))).toHaveValue(CONVERSION_FROM);
		await expect(page.getByLabel(text("終了日", "To"))).toHaveValue(CONVERSION_TO);
	});

	test("creates a Unicode event goal, edits its name and disables it durably", async ({ page }) => {
		await page.goto(path);
		await page.getByRole("button", { name: text("CV設定", "CV settings"), exact: true }).click();
		let dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: text("CVを追加", "Add conversion"), exact: true }).click();
		const form = dialog.getByRole("form", { name: text("CVを追加", "Add conversion"), exact: true });
		await form.getByLabel(text("CV名", "Conversion name"), { exact: true }).fill("応募完了テスト");
		await form.getByLabel(text("GA4キーイベント", "GA4 key event"), { exact: true }).selectOption("応募完了");
		await expect(form.getByText(text("イベントごと", "Once per event"), { exact: true })).toBeVisible();
		await form.getByRole("button", { name: text("CVを保存", "Save conversion"), exact: true }).click();
		await expect(
			dialog.getByText(text("CV設定を保存しました", "Conversion settings saved"), { exact: true }),
		).toBeVisible();
		await dialog.getByRole("button", { name: `${text("編集", "Edit")}: 応募完了テスト`, exact: true }).click();
		const editor = dialog.getByRole("form", { name: text("CVを編集", "Edit conversion"), exact: true });
		await editor.getByLabel(text("CV名", "Conversion name"), { exact: true }).fill("応募完了更新");
		await editor.getByRole("button", { name: text("CVを保存", "Save conversion"), exact: true }).click();
		await dialog.getByRole("button", { name: `${text("無効にする", "Disable")}: 応募完了更新`, exact: true }).click();
		await expect(
			dialog.getByRole("button", { name: `${text("有効にする", "Enable")}: 応募完了更新`, exact: true }),
		).toBeVisible();
		const state = await readConversionFixtureState();
		expect(state.goals.find((goal) => goal.event_name === "応募完了")).toMatchObject({
			display_name: "応募完了更新",
			enabled: false,
			revision: 3,
		});
		await dialog
			.getByRole("button", { name: text("閉じる", "Close"), exact: true })
			.first()
			.click();
		await page.reload();
		await page.getByRole("button", { name: text("CV設定", "CV settings"), exact: true }).click();
		dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("button", { name: `${text("有効にする", "Enable")}: 応募完了更新`, exact: true }),
		).toBeVisible();
	});

	test("labels observed host scope and never presents an unverified CVR", async ({ page }) => {
		await seedConversionFixtures(true);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(path);
		await expect(
			page.getByRole("heading", {
				name: text(
					"CVしたセッションの開始パス（開始ホスト未判定）",
					"Landing paths of converting sessions (entry host unverified)",
				),
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByText(
				text(
					"同じ集計対象のセッション数を確認できないため、CVRは表示できません。計測分の開始数で代用しません。",
					"CVR is unavailable because matching session denominators have not been verified. Recorded session starts are not used as a substitute.",
				),
				{ exact: true },
			),
		).toBeVisible();
		const metric = page.getByRole("combobox", { name: text("グラフの指標", "Chart metric"), exact: true });
		await expect(metric.locator('option[value="cvr"]')).toHaveJSProperty("disabled", true);
		const period = page.locator("section").filter({
			has: page.getByRole("heading", { name: text("期間別のコンバージョン", "Conversions by period"), exact: true }),
		});
		await expect(period.locator("tfoot td")).toHaveText(["112", "280", "—", "—"]);
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
	});
});
