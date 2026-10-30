import { expect, test } from "@playwright/test";
import {
	BRAND_FLOW_ID,
	BRAND_FLOW_NAME,
	BRAND_OTHER_ID,
	BRAND_OTHER_NAME,
	NEW_BRAND_PREFIX,
	RETRY_BRAND_NAME,
	cleanupBrandFlowFixtures,
	countBrandOrganizations,
	readCreatedBrand,
	setBrandInsertFailure,
	seedBrandFlowFixtures,
} from "../brand-fixtures";

const ja = !process.env.VITE_APP_LOCALE || /^ja(?:-|$)/i.test(process.env.VITE_APP_LOCALE);
const text = (japanese: string, english: string) => (ja ? japanese : english);
const switchLabel = (name: string) => `${text("ブランドを切り替える", "Switch brand")}: ${name}`;
const searchLabel = text("ブランド名・URLで検索", "Search brands by name or URL");
const trafficPath = `/app/${BRAND_FLOW_ID}/traffic`;

test.describe("Local brand creation and switching", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeAll(seedBrandFlowFixtures);
	test.afterAll(async () => {
		await setBrandInsertFailure(false);
		await cleanupBrandFlowFixtures();
	});

	test("preserves invalid input, creates a Japanese brand atomically and waits for explicit AI setup", async ({ page }) => {
		const name = `${NEW_BRAND_PREFIX} 日本語サイト`;
		const website = "brand-after.example.com";
		const brandPosts: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST" && request.postData()?.includes(website)) brandPosts.push(request.url());
		});
		await page.goto(`/app/${BRAND_FLOW_ID}`);
		await page.getByRole("button", { name: switchLabel(BRAND_FLOW_NAME), exact: true }).click();
		await page.getByRole("button", { name: text("ブランドを追加", "Add brand"), exact: true }).click();
		await expect(page).toHaveURL(/\/app\/new\?/);
		await page.getByLabel(text("ブランド名", "Brand name"), { exact: true }).fill(name);
		await page.getByLabel(text("ウェブサイト", "Website"), { exact: true }).fill("bad domain");
		await page.getByRole("button", { name: text("ブランドを作成", "Create brand"), exact: true }).click();
		await expect(page.getByRole("alert")).toContainText(
			text("有効なウェブサイトのURLまたはドメインを入力してください。", "Enter a valid website URL or domain."),
		);
		await expect(page.getByLabel(text("ブランド名", "Brand name"), { exact: true })).toHaveValue(name);
		await expect(page.getByLabel(text("ウェブサイト", "Website"), { exact: true })).toHaveValue("bad domain");
		expect(await readCreatedBrand(name)).toHaveLength(0);
		await page.getByLabel(text("ウェブサイト", "Website"), { exact: true }).fill(website);
		await page.getByRole("button", { name: text("ブランドを作成", "Create brand"), exact: true }).click();
		await expect(page.getByRole("button", { name: switchLabel(name), exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: text("ブランド分析を開始", "Start brand analysis"), exact: true })).toBeVisible();
		// Saving is the only POST containing the website: opening the new brand does not auto-start AI analysis.
		expect(brandPosts).toHaveLength(1);
		const rows = await readCreatedBrand(name);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name,
			website: `https://${website}/`,
			target_market: null,
			target_language: null,
			admins: 1,
			ga4_connections: 0,
			views: 0,
			goals: 0,
		});
		expect(rows[0].organization_id).toBe(rows[0].id);
		await page.reload();
		await expect(page.getByRole("button", { name: switchLabel(name), exact: true })).toBeVisible();
		await page.getByRole("button", { name: switchLabel(name), exact: true }).click();
		await page.getByRole("link", { name: text("すべてのブランドを見る", "View all brands"), exact: true }).click();
		await expect(page.getByText(text("ブランド一覧", "Brands"), { exact: true })).toBeVisible();
		await page.getByRole("textbox", { name: searchLabel, exact: true }).fill(website);
		await expect(page.getByRole("link").filter({ hasText: name })).toBeVisible();
		await expect(page.getByRole("link").filter({ hasText: BRAND_OTHER_NAME })).toHaveCount(0);
	});

	test("rolls back all provisioning on a database failure and retries without duplicating the brand", async ({ page }) => {
		await setBrandInsertFailure(true);
		try {
			await page.goto("/app/new");
			await page.getByLabel(text("ブランド名", "Brand name"), { exact: true }).fill(RETRY_BRAND_NAME);
			await page.getByLabel(text("ウェブサイト", "Website"), { exact: true }).fill("brand-retry.example.com");
			await page.getByRole("button", { name: text("ブランドを作成", "Create brand"), exact: true }).click();
			await expect(page.getByRole("alert")).toContainText(
				text("ブランドを保存できませんでした。入力内容は保持されています。", "Unable to save the brand. Your inputs are preserved."),
			);
			await expect(page.getByLabel(text("ブランド名", "Brand name"), { exact: true })).toHaveValue(RETRY_BRAND_NAME);
			await expect(page.getByLabel(text("ウェブサイト", "Website"), { exact: true })).toHaveValue("brand-retry.example.com");
			expect(await readCreatedBrand(RETRY_BRAND_NAME)).toHaveLength(0);
			expect(await countBrandOrganizations(RETRY_BRAND_NAME)).toBe(0);
		} finally {
			await setBrandInsertFailure(false);
		}
		await page.getByRole("button", { name: text("ブランドを作成", "Create brand"), exact: true }).click();
		await expect(page.getByRole("button", { name: switchLabel(RETRY_BRAND_NAME), exact: true })).toBeVisible();
		expect(await readCreatedBrand(RETRY_BRAND_NAME)).toHaveLength(1);
		expect(await countBrandOrganizations(RETRY_BRAND_NAME)).toBe(1);
	});

	test("creates from traffic and opens only the new brand's unconnected GA4 state", async ({ page }) => {
		const name = `${NEW_BRAND_PREFIX} トラフィック`;
		await page.goto(trafficPath);
		await page.getByRole("button", { name: switchLabel(BRAND_FLOW_NAME), exact: true }).click();
		await page.getByRole("button", { name: text("ブランドを追加", "Add brand"), exact: true }).click();
		await page.getByLabel(text("ブランド名", "Brand name"), { exact: true }).fill(name);
		await page.getByLabel(text("ウェブサイト", "Website"), { exact: true }).fill("brand-traffic.example.com");
		await page.getByRole("button", { name: text("ブランドを作成", "Create brand"), exact: true }).click();
		await expect(page.getByRole("button", { name: switchLabel(name), exact: true })).toBeVisible();
		await expect(page).toHaveURL(/\/traffic(?:\?|$)/);
		await expect(page.getByRole("button", { name: text("Google Analyticsを接続", "Connect Google Analytics"), exact: true })).toBeVisible();
		await expect(page.getByRole("tab", { name: "トップページ", exact: true })).toHaveCount(0);
		const rows = await readCreatedBrand(name);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ ga4_connections: 0, views: 0, goals: 0 });
	});

	test("switches by domain, retains portable dates and grain, and clears brand-specific analysis state", async ({ page }) => {
		const params = new URLSearchParams({
			from: "2026-10-02", to: "2026-10-29", grain: "month", chart: "sources", analysisTab: "conversions",
			viewId: "00000000-0000-4000-8000-430000000001", conversionGoalId: "00000000-0000-4000-8000-430000000002",
			detail: "/private-path", conditions: JSON.stringify([{ mode: "include", operator: "exact", value: "/private-path" }]),
			pageSearch: "private-path", page: "2",
		});
		await page.goto(`${trafficPath}?${params}`);
		await page.getByRole("button", { name: switchLabel(BRAND_FLOW_NAME), exact: true }).click();
		await page.getByRole("combobox", { name: searchLabel, exact: true }).fill("brand-other.example.com");
		await page.getByRole("option").filter({ hasText: BRAND_OTHER_NAME }).click();
		await expect(page.getByRole("button", { name: switchLabel(BRAND_OTHER_NAME), exact: true })).toBeVisible();
		const destination = new URL(page.url());
		expect(destination.pathname).toBe(`/app/${BRAND_OTHER_ID}/traffic`);
		for (const key of ["from", "to", "grain", "chart", "analysisTab"]) expect(destination.searchParams.get(key)).toBe(params.get(key));
		for (const key of ["viewId", "conversionGoalId", "detail", "conditions", "pageSearch", "page"]) expect(destination.searchParams.has(key)).toBe(false);
		await page.reload();
		await expect(page.getByRole("button", { name: switchLabel(BRAND_OTHER_NAME), exact: true })).toBeVisible();
	});

	test("offers an accessible mobile picker and cancels addition back to the current brand", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(trafficPath);
		await page.getByRole("button", { name: text("サイドバーを切り替える", "Toggle Sidebar"), exact: true }).first().click();
		const trigger = page.getByRole("button", { name: switchLabel(BRAND_FLOW_NAME), exact: true });
		await trigger.click();
		const picker = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: text("ブランドを切り替える", "Switch brand"), exact: true }) });
		await expect(picker).toBeVisible();
		await expect.poll(() => picker.evaluate((element) => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
		await picker.getByRole("combobox", { name: searchLabel, exact: true }).fill("brand-other.example.com");
		await expect(picker.getByRole("option").filter({ hasText: BRAND_OTHER_NAME })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(picker).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await picker.getByRole("button", { name: text("ブランドを追加", "Add brand"), exact: true }).click();
		await page.getByRole("link", { name: text("キャンセル", "Cancel"), exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/app/${BRAND_FLOW_ID}/traffic`));
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
	});
});
