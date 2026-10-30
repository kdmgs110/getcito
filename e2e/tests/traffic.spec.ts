import { expect, test } from "@playwright/test";
import { seedTrafficFixtures, TRAFFIC_BRAND_ID, TRAFFIC_FROM, TRAFFIC_TO } from "../traffic-fixtures";

const ja = !process.env.VITE_APP_LOCALE || /^ja(?:-|$)/i.test(process.env.VITE_APP_LOCALE);
const text = (japanese: string, english: string) => (ja ? japanese : english);
const path = `/app/${TRAFFIC_BRAND_ID}/traffic?from=${TRAFFIC_FROM}&to=${TRAFFIC_TO}`;

test.describe("GA4 traffic analysis", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeEach(async () => {
		await seedTrafficFixtures();
	});

	test("shows ingress metrics, changes granularity and opens an exact-page trend", async ({ page }) => {
		await page.goto(path);
		await expect(
			page.getByRole("heading", { name: text("トラフィック分析", "Traffic analysis"), exact: true }),
		).toBeVisible();
		await expect(page.locator(`a[href='/app/${TRAFFIC_BRAND_ID}/traffic'][data-sidebar='menu-button']`)).toBeVisible();
		await expect(page.getByText("280", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("2,800", { exact: true }).first()).toBeVisible();
		const pageList = page.locator("section").filter({
			has: page.getByRole("heading", { name: text("ページ別トラフィック", "Traffic by page"), exact: true }),
		});
		await expect(
			pageList.getByRole("columnheader", { name: text("ページタイトル / URL", "Page title / URL") }),
		).toBeVisible();
		const engineer = pageList.getByRole("rowheader").filter({ hasText: "エンジニアのフリーランス案件" });
		await expect(engineer).toContainText("https://example.com/job_listings/engineer/");
		expect(
			await pageList.locator("table").evaluate((table) =>
				table.getBoundingClientRect().width <= (table.parentElement?.clientWidth ?? 0) + 1,
			),
		).toBe(true);
		const title = engineer.locator("span").first();
		const url = engineer.getByRole("link");
		await expect(url).toHaveAttribute("href", "https://example.com/job_listings/engineer/");
		await expect(url).toHaveAttribute("target", "_blank");
		await expect(url).toHaveAttribute("rel", "noopener noreferrer");
		expect((await title.boundingBox())?.y).toBeLessThan((await url.boundingBox())?.y ?? 0);
		await expect(
			pageList.getByRole("rowheader").filter({ hasText: text("タイトル未取得", "Title unavailable") }),
		).toContainText("https://example.com/job_listings/marketing/");
		await page
			.getByRole("tab", { name: text("月別", "Monthly"), exact: true })
			.first()
			.click();
		const period = page
			.locator("section")
			.filter({
				has: page.getByRole("heading", { name: text("期間別のトラフィック", "Traffic by period"), exact: true }),
			});
		await expect(period.locator("tbody tr")).toHaveCount(1);
		await expect(period).toContainText("280");
		await expect(
			page
				.getByRole("img", { name: text("AI流入の推移", "AI traffic trend"), exact: true })
				.locator(".recharts-line-dots circle"),
		).toHaveCount(1);
		await page
			.getByRole("tab", { name: text("週別", "Weekly"), exact: true })
			.first()
			.click();
		await expect(period.locator("tbody tr")).toHaveCount(5);
		await page
			.getByRole("button", { name: `${text("推移を見る", "View trend")}: /job_listings/engineer/`, exact: true })
			.click();
		const detail = page.getByRole("dialog");
		await expect(
			detail.getByRole("heading", { name: text("ページ別の推移", "Traffic trend by page"), exact: true }),
		).toBeVisible();
		await expect(detail.getByText("/job_listings/engineer/", { exact: true })).toBeVisible();
		await expect(detail.getByText("84", { exact: true }).first()).toBeVisible();
		await expect(detail.getByText("840", { exact: true }).first()).toBeVisible();
		await detail.getByRole("tab", { name: text("AI別", "By AI source"), exact: true }).click();
		await expect(detail.getByRole("button", { name: "ChatGPT", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(detail).not.toBeVisible();
		await expect(page).not.toHaveURL(/detail=/);
	});

	test("switches saved scopes, preserves dates, and searches only the page ranking", async ({ page }) => {
		await page.goto(path);
		await page.getByRole("tab", { name: "トップページ", exact: true }).click();
		await expect(page.getByText("112", { exact: true }).first()).toBeVisible();
		await expect(page.getByLabel(text("開始日", "From"))).toHaveValue(TRAFFIC_FROM);
		await page.getByRole("tab", { name: "求人一覧配下", exact: true }).click();
		await expect(page.getByText("168", { exact: true }).first()).toBeVisible();
		await expect(page.getByLabel(text("終了日", "To"))).toHaveValue(TRAFFIC_TO);
		const search = page.getByRole("textbox", {
			name: text("一覧内のパスを検索", "Search within this page list"),
			exact: true,
		});
		await search.fill("engineer");
		await search.press("Enter");
		const ranking = page
			.locator("section")
			.filter({
				has: page.getByRole("heading", { name: text("ページ別トラフィック", "Traffic by page"), exact: true }),
			});
		await expect(ranking.locator("tbody tr")).toHaveCount(1);
		await expect(ranking).toContainText("/job_listings/engineer/");
		await expect(page.getByText("168", { exact: true }).first()).toBeVisible();
		await page.reload();
		await expect(page.getByRole("tab", { name: "求人一覧配下", exact: true })).toHaveAttribute("data-state", "active");
	});

	test("registers, edits and deletes a shared saved view without replacing the original", async ({ page }) => {
		await page.goto(path);
		await page.getByRole("button", { name: text("登録", "Register"), exact: true }).click();
		let dialog = page.getByRole("dialog");
		await dialog.getByLabel(text("登録名", "View name"), { exact: true }).fill("E2Eホーム");
		await dialog.getByRole("button", { name: text("条件を追加", "Add condition"), exact: true }).click();
		await dialog.getByRole("textbox", { name: text("ページパス 1", "Page path 1"), exact: true }).fill("/");
		await dialog.getByRole("button", { name: text("登録して表示", "Save and display"), exact: true }).click();
		await expect(page.getByRole("tab", { name: "E2Eホーム", exact: true })).toHaveAttribute("data-state", "active");
		await expect(page.getByText("112", { exact: true }).first()).toBeVisible();
		await page.getByRole("button", { name: text("一覧・管理", "Manage views"), exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByRole("textbox", { name: text("登録済みビューを検索", "Search saved views"), exact: true })
			.fill("E2Eホーム");
		await dialog.getByRole("button", { name: text("編集", "Edit"), exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog.getByLabel(text("登録名", "View name"), { exact: true }).fill("E2Eホーム更新");
		await dialog.getByRole("button", { name: text("保存", "Save"), exact: true }).click();
		await expect(page.getByRole("tab", { name: "E2Eホーム更新", exact: true })).toBeVisible();
		await page.getByRole("button", { name: text("一覧・管理", "Manage views"), exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByRole("textbox", { name: text("登録済みビューを検索", "Search saved views"), exact: true })
			.fill("E2Eホーム更新");
		await dialog.getByRole("button", { name: text("削除", "Delete"), exact: true }).click();
		await page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: text("削除", "Delete"), exact: true })
			.click();
		await expect(
			page.getByRole("heading", {
				name: text("登録済みビューを削除しますか？", "Delete this saved view?"),
				exact: true,
			}),
		).toBeHidden();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("tab", { name: "E2Eホーム更新", exact: true })).toHaveCount(0);
		await expect(page.getByRole("tab", { name: "トップページ", exact: true })).toBeVisible();
	});

	test("applies contains, RE2 and combined exclusion filters and rejects invalid expressions", async ({ page }) => {
		await page.goto(path);
		const filter = page.getByRole("form", { name: text("対象ページ", "Target pages"), exact: true });
		const ranking = page
			.locator("section")
			.filter({
				has: page.getByRole("heading", { name: text("ページ別トラフィック", "Traffic by page"), exact: true }),
			});
		await filter.getByRole("button", { name: text("条件を追加", "Add condition"), exact: true }).click();
		const operator = filter.getByRole("combobox", {
			name: text("登録する条件 1", "Conditions to save 1"),
			exact: true,
		});
		const input = filter.getByRole("textbox", { name: text("ページパス 1", "Page path 1"), exact: true });
		await operator.selectOption("contains");
		await input.fill("/engineer");
		await input.press("Enter");
		await expect(ranking.locator("tbody tr")).toHaveCount(1);
		await expect(page.getByText("840", { exact: true }).first()).toBeVisible();
		await operator.selectOption("regex");
		await input.fill("/job_listings/(engineer|marketing)/");
		await input.press("Enter");
		await expect(ranking.locator("tbody tr")).toHaveCount(2);
		await expect(page.getByText("1,120", { exact: true }).first()).toBeVisible();
		await operator.selectOption("subtree");
		await input.fill("/job_listings/");
		await input.press("Enter");
		await expect(page.getByText("1,680", { exact: true }).first()).toBeVisible();
		await filter.getByRole("button", { name: text("条件を追加", "Add condition"), exact: true }).click();
		await filter
			.getByRole("combobox", { name: text("含める / 除外する 2", "Include / Exclude 2"), exact: true })
			.selectOption("exclude");
		await filter
			.getByRole("textbox", { name: text("ページパス 2", "Page path 2"), exact: true })
			.fill("/job_listings/engineer/");
		await filter.getByRole("button", { name: text("適用", "Apply"), exact: true }).click();
		await expect(ranking.locator("tbody tr")).toHaveCount(2);
		await expect(ranking).not.toContainText("/job_listings/engineer/");
		await expect(page.getByText("840", { exact: true }).first()).toBeVisible();
		const appliedUrl = page.url();
		await operator.selectOption("regex");
		await input.fill("(?<=/)engineer");
		await input.press("Enter");
		await expect(page.getByRole("alert")).toBeVisible();
		expect(page.url()).toBe(appliedUrl);
	});

	test("keeps mobile analysis within the viewport and opens a full-width detail sheet", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(path);
		await page
			.getByRole("combobox", { name: text("登録済み", "Saved views"), exact: true })
			.selectOption({ label: "トップページ" });
		await expect(page.getByText("112", { exact: true }).first()).toBeVisible();
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.getByRole("button", { name: `${text("推移を見る", "View trend")}: /`, exact: true }).click();
		const detail = page.getByRole("dialog");
		await expect(detail).toBeVisible();
		await expect(detail.getByText("112", { exact: true }).first()).toBeVisible();
		await expect.poll(() => detail.evaluate((el) => el.getBoundingClientRect().width <= innerWidth)).toBe(true);
	});

	test("starts read-only OAuth with state and PKCE without contacting Google", async ({ page }) => {
		await page.route("https://accounts.google.com/**", (route) =>
			route.fulfill({ status: 200, contentType: "text/html", body: "OAuth redirect intercepted for E2E" }),
		);
		await page.goto("/app/default/traffic");
		await page
			.getByRole("button", { name: text("Google Analyticsを接続", "Connect Google Analytics"), exact: true })
			.click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: text("Google Analyticsを接続", "Connect Google Analytics"), exact: true })
			.click();
		await page.waitForURL("https://accounts.google.com/**");
		const oauth = new URL(page.url());
		expect(oauth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/analytics.readonly");
		expect(oauth.searchParams.get("state")).toBeTruthy();
		expect(oauth.searchParams.get("code_challenge_method")).toBe("S256");
		expect(oauth.searchParams.get("code_challenge")).toBeTruthy();
		expect(oauth.searchParams.get("access_type")).toBe("offline");
	});
});
