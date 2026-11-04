import { expect, test } from "@playwright/test";
import {
	GSC_BEST_QUESTION,
	GSC_BRAND_ID,
	GSC_DATES,
	GSC_FOUR_TERMS,
	GSC_JOBS_URL,
	GSC_LONG_QUERY,
	GSC_SHORT_QUESTION,
	GSC_SHORT_REQUEST,
	seedSearchConsoleFixtures,
} from "../search-console-fixtures";

const ja = !process.env.VITE_APP_LOCALE || /^ja(?:-|$)/i.test(process.env.VITE_APP_LOCALE);
const text = (japanese: string, english: string) => (ja ? japanese : english);
const path = `/app/${GSC_BRAND_ID}/keywords?startDate=${GSC_DATES.startDate}&endDate=${GSC_DATES.endDate}`;

test.describe("Search Console keyword analysis", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeEach(async () => {
		await seedSearchConsoleFixtures();
	});

	test("shows 100 rows, paginates, and immediately prioritizes AI-like questions when toggled", async ({ page }) => {
		await page.goto(path);
		await expect(
			page.getByRole("heading", { name: text("流入キーワード分析", "Search keyword analysis"), exact: true }),
		).toBeVisible();
		await expect(page.locator(`a[href='/app/${GSC_BRAND_ID}/keywords'][data-sidebar='menu-button']`)).toBeVisible();
		const rows = page.locator("table tbody tr");
		await expect(rows).toHaveCount(100);
		await expect(page.getByRole("rowheader").first()).toHaveText("一般検索語001");
		const toggle = page.getByRole("switch", { name: text("AI質問フィルタ", "AI question filter"), exact: true });
		await expect(toggle).not.toBeChecked();
		await page.getByRole("button", { name: text("次のページ", "Next page"), exact: true }).click();
		await expect(rows).toHaveCount(25);
		await expect(page).toHaveURL(/page=2/);
		await page
			.getByRole("columnheader", { name: text("表示回数", "Impressions"), exact: true })
			.getByRole("button")
			.click();
		await expect(rows).toHaveCount(100);
		await expect(page.getByRole("rowheader").first()).toHaveText("=SUM(1,2)");
		await expect(page).not.toHaveURL(/page=2/);
		// No Apply click: the toggle must immediately change the server filter and
		// reset the previous metric sort to question-like priority.
		await toggle.click();
		await expect(page).toHaveURL(/aiQuestionsOnly=true/);
		await expect(toggle).toBeChecked();
		await expect(rows).toHaveCount(5);
		await expect(page.getByRole("rowheader").first()).toContainText(GSC_BEST_QUESTION);
		await expect(
			page.getByRole("button", { name: text("AI質問らしさ順", "Question-like priority"), exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		for (const query of [GSC_SHORT_REQUEST, GSC_SHORT_QUESTION, GSC_FOUR_TERMS, GSC_LONG_QUERY])
			await expect(page.getByRole("rowheader").filter({ hasText: query })).toHaveCount(1);
		await expect(
			page.getByText(text("AI経由の判定ではありません", "Does not identify AI traffic"), { exact: false }),
		).toBeVisible();
		await page.reload();
		await expect(toggle).toBeChecked();
		await expect(rows).toHaveCount(5);
		await expect(page.getByRole("rowheader").first()).toContainText(GSC_BEST_QUESTION);
	});

	test("combines URL subtree and exclusion conditions with AI and keyword filters, then clears them", async ({
		page,
	}) => {
		await page.goto(path);
		const filter = page.getByRole("form", { name: text("適用中の条件", "Applied filters"), exact: true });
		const rows = page.locator("table tbody tr");
		await expect(rows).toHaveCount(100);
		await filter.getByRole("button", { name: text("条件を追加", "Add condition"), exact: true }).click();
		await filter
			.getByRole("combobox", { name: text("URL条件 1 の比較方法", "URL condition 1"), exact: true })
			.selectOption("subtree");
		await filter.getByRole("textbox", { name: text("URL条件 1 の値", "URL value 1"), exact: true }).fill(GSC_JOBS_URL);
		// Draft conditions must not silently change the displayed result.
		await expect(rows).toHaveCount(100);
		await expect(page).not.toHaveURL(/urlConditions=/);
		await filter.getByRole("button", { name: text("適用", "Apply"), exact: true }).click();
		await expect(rows).toHaveCount(4);
		await filter.getByRole("button", { name: text("条件を追加", "Add condition"), exact: true }).click();
		await filter
			.getByRole("combobox", { name: text("URL条件 2 の比較方法", "URL condition 2"), exact: true })
			.selectOption("notContains");
		await filter.getByRole("textbox", { name: text("URL条件 2 の値", "URL value 2"), exact: true }).fill("/archive/");
		await filter.getByRole("button", { name: text("適用", "Apply"), exact: true }).click();
		await expect(rows).toHaveCount(3);
		await expect(page.getByRole("rowheader").filter({ hasText: GSC_FOUR_TERMS })).toHaveCount(0);
		await filter.getByRole("switch", { name: text("AI質問フィルタ", "AI question filter"), exact: true }).click();
		await expect(page).toHaveURL(/aiQuestionsOnly=true/);
		await expect(rows).toHaveCount(3);
		await filter.getByRole("searchbox", { name: text("キーワード", "Keyword"), exact: true }).fill("独立");
		await filter.getByRole("button", { name: text("適用", "Apply"), exact: true }).click();
		await expect(rows).toHaveCount(1);
		await expect(page.getByRole("rowheader").first()).toContainText(GSC_SHORT_QUESTION);
		await expect(filter.getByLabel(text("開始日（PT）", "Start date (PT)"))).toHaveValue(GSC_DATES.startDate);
		await page.reload();
		await expect(rows).toHaveCount(1);
		await expect(filter.getByRole("textbox", { name: text("URL条件 2 の値", "URL value 2"), exact: true })).toHaveValue(
			"/archive/",
		);
		await filter.getByRole("button", { name: text("クリア", "Clear"), exact: true }).click();
		await expect(rows).toHaveCount(100);
		await expect(page).not.toHaveURL(/urlConditions=|aiQuestionsOnly=true|keyword=/);
		await expect(filter.getByLabel(text("開始日（PT）", "Start date (PT)"))).toHaveValue(GSC_DATES.startDate);
	});

	test("exports all retrieved rows safely and rejects an invalid full URL without replacing results", async ({
		page,
	}) => {
		await page.goto(path);
		await expect(page.locator("table tbody tr")).toHaveCount(100);
		const downloadPromise = page.waitForEvent("download");
		await page.getByRole("button", { name: text("CSV出力", "Export CSV"), exact: true }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe(`search-keywords-${GSC_DATES.startDate}-${GSC_DATES.endDate}.csv`);
		const stream = await download.createReadStream();
		if (!stream) throw new Error("CSV download stream was unavailable");
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		const csv = Buffer.concat(chunks).toString("utf8");
		expect(csv.startsWith("\uFEFF")).toBe(true);
		expect(csv.split("\r\n")).toHaveLength(126);
		expect(csv).toContain('"\'=SUM(1,2)"');
		expect(csv).toContain(GSC_BEST_QUESTION);
		const filter = page.getByRole("form", { name: text("適用中の条件", "Applied filters"), exact: true });
		await filter.getByRole("button", { name: text("条件を追加", "Add condition"), exact: true }).click();
		await filter
			.getByRole("combobox", { name: text("URL条件 1 の比較方法", "URL condition 1"), exact: true })
			.selectOption("subtree");
		await filter
			.getByRole("textbox", { name: text("URL条件 1 の値", "URL value 1"), exact: true })
			.fill("/relative/path/");
		const before = page.url();
		await filter.getByRole("button", { name: text("適用", "Apply"), exact: true }).click();
		await expect(filter.getByRole("alert")).toBeVisible();
		await expect(page.locator("table tbody tr")).toHaveCount(100);
		expect(page.url()).toBe(before);
	});

	test("starts GSC-only read-only OAuth with state and PKCE without contacting Google", async ({ page }) => {
		await page.route("https://accounts.google.com/**", (route) =>
			route.fulfill({ status: 200, contentType: "text/html", body: "OAuth redirect intercepted for E2E" }),
		);
		await page.goto("/app/default/keywords");
		await page
			.getByRole("button", { name: text("連携設定", "Connection settings"), exact: true })
			.first()
			.click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: text("Googleで連携する", "Connect with Google"), exact: true })
			.click();
		await page.waitForURL("https://accounts.google.com/**");
		const oauth = new URL(page.url());
		expect(oauth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
		expect(oauth.searchParams.get("redirect_uri")).toBe(
			`${new URL(process.env.BASE_URL || "http://localhost:1515").origin}/api/search-console/google/callback`,
		);
		expect(oauth.searchParams.get("state")).toMatch(/^[A-Za-z\d_-]{43}$/);
		expect(oauth.searchParams.get("code_challenge_method")).toBe("S256");
		expect(oauth.searchParams.get("code_challenge")).toBeTruthy();
		expect(oauth.searchParams.get("access_type")).toBe("offline");
	});
});
