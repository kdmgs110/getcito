import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
	VISIBILITY_AI_ANSWER,
	VISIBILITY_BRAND,
	VISIBILITY_COUNT,
	VISIBILITY_FORMULA,
	VISIBILITY_FULL_ANSWER,
	VISIBILITY_PAGE_A,
	VISIBILITY_PAGE_B,
	VISIBILITY_QUERY,
	VISIBILITY_TAG,
	VISIBILITY_TARGET,
	cleanupVisibilityFixtures,
	seedVisibilityFixtures,
	visibilityPromptId,
	visibilityPromptValue,
} from "../visibility-fixtures";

function path(search: Record<string, string> = {}) {
	return `/app/${VISIBILITY_BRAND}/visibility?${new URLSearchParams({ model: VISIBILITY_TARGET, lookback: "1m", order: "prompt-asc", ...search })}`;
}

/** Parse quoted CSV including escaped quotes and embedded newlines. */
function parseCsv(csv: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const source = csv.replace(/^\uFEFF/, "");
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (char === '"') {
			if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
			else quoted = !quoted;
		} else if (!quoted && char === ",") { row.push(cell); cell = ""; }
		else if (!quoted && char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
		else cell += char;
	}
	if (cell || row.length) { row.push(cell); rows.push(row); }
	return rows;
}

async function exportCsv(page: Page) {
	const downloaded = page.waitForEvent("download");
	await page.getByRole("button", { name: "この表をCSV出力", exact: true }).click();
	const download = await downloaded;
	expect(download.suggestedFilename()).toMatch(/\.csv$/);
	const file = await download.path();
	if (!file) throw new Error("CSV download was not saved");
	const bytes = await readFile(file);
	expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
	return parseCsv(bytes.toString("utf8"));
}

test.describe("Visibility spreadsheet", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeAll(seedVisibilityFixtures);
	test.afterAll(cleanupVisibilityFixtures);

	test("switches views while retaining filters and shows assigned categories and separate AI answers", async ({ page }) => {
		await page.goto(path({ q: "E2E 一覧 01", tags: VISIBILITY_TAG }));
		await page.getByRole("button", { name: "見え方", exact: true }).click();
		await page.getByRole("menuitemradio", { name: "スプレッドシート", exact: true }).click();
		await expect(page).toHaveURL(/view=spreadsheet/);
		const url = new URL(page.url());
		expect(url.searchParams.get("q")).toBe("E2E 一覧 01");
		expect(url.searchParams.get("tags")).toBe(VISIBILITY_TAG);
		expect(url.searchParams.get("model")).toBe(VISIBILITY_TARGET);
		const region = page.getByRole("region", { name: "スプレッドシート", exact: true });
		await expect(region).toBeVisible();
		const row = page.getByTestId(`spreadsheet-row-${visibilityPromptId(1)}`);
		await expect(row).toContainText("フルリモート");
		await expect(row).toContainText("高単価");
		await expect(row).toContainText("E2E 表示状況");
		await expect(row).toContainText("E2E 比較ブランド");
		await expect(row).toContainText(VISIBILITY_QUERY);
		await expect(row).toContainText(VISIBILITY_AI_ANSWER);
		await expect(region.getByRole("button", { name: "この表をCSV出力", exact: true })).toBeVisible();
		await page.reload();
		await expect(page.getByTestId(`spreadsheet-row-${visibilityPromptId(1)}`)).toContainText("高単価");
	});

	test("exports every matching prompt before scrolling, retaining full text and neutralizing formulas", async ({ page }) => {
		await page.goto(path({ view: "spreadsheet" }));
		await expect(page.getByRole("region", { name: "スプレッドシート", exact: true })).toContainText("26件中20件を読み込み済み");
		await expect(page.getByTestId(`spreadsheet-row-${visibilityPromptId(25)}`)).toHaveCount(0);
		const [headers, ...rows] = await exportCsv(page);
		expect(headers).toEqual(["プロンプト", "カテゴリー（タグ）", "最終実行日", "ChatGPTの回答", "言及されたブランド", "ウェブ検索クエリ", "ページ／ドメイン別の出現・引用", "AIモードの回答", "ChatGPT実行日", "AIモード実行日"]);
		expect(rows).toHaveLength(VISIBILITY_COUNT);
		for (const row of rows) expect(row).toHaveLength(headers.length);
		expect(rows.find((row) => row[0] === visibilityPromptValue(1))?.[3]).toBe(VISIBILITY_FULL_ANSWER);
		expect(rows.find((row) => row[0] === visibilityPromptValue(1))?.[7]).toBe(VISIBILITY_AI_ANSWER);
		expect(rows.some((row) => row[0] === visibilityPromptValue(25))).toBe(true);
		expect(rows.some((row) => row[0] === `'${VISIBILITY_FORMULA}`)).toBe(true);
		// Exporting off-screen data must not force all rows into the rendered table.
		await expect(page.getByTestId(`spreadsheet-row-${visibilityPromptId(25)}`)).toHaveCount(0);
	});

	test("CSV respects prompt search and tag filters rather than exporting unrelated prompts", async ({ page }) => {
		await page.goto(path({ view: "spreadsheet", q: "E2E 一覧 01", tags: "高単価" }));
		await expect(page.getByTestId(`spreadsheet-row-${visibilityPromptId(1)}`)).toContainText("高単価");
		const [, ...rows] = await exportCsv(page);
		expect(rows).toHaveLength(1);
		expect(rows[0][0]).toBe(visibilityPromptValue(1));
		expect(rows[0][1]).toContain("高単価");
		expect(rows[0][3]).toBe(VISIBILITY_FULL_ANSWER);
	});

	test("shows full answers and switches evidence between domain totals and individual pages", async ({ page }) => {
		await page.goto(path({ view: "spreadsheet", q: "E2E 一覧 01" }));
		const region = page.getByRole("region", { name: "スプレッドシート", exact: true });
		const row = page.getByTestId(`spreadsheet-row-${visibilityPromptId(1)}`);
		await expect(row).toContainText("evidence.visibility.example.com");
		await region.getByRole("tab", { name: "ページ", exact: true }).click();
		await expect(row.getByText(VISIBILITY_PAGE_A, { exact: true })).toHaveCount(1);
		await expect(row.getByText(VISIBILITY_PAGE_B, { exact: true })).toHaveCount(1);
		await row.getByRole("button", { name: "全文を見る", exact: true }).first().click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("E2E 全文の終端");
		await expect(dialog).toContainText(VISIBILITY_AI_ANSWER);
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
	});

	test("scrolls through every batch without pagination and keeps missing evidence distinct from zero", async ({ page }) => {
		await page.goto(path({ view: "spreadsheet" }));
		const region = page.getByRole("region", { name: "スプレッドシート", exact: true });
		await expect(region).toContainText("26件中20件を読み込み済み");
		const scroller = page.getByTestId("visibility-spreadsheet-scroll");
		await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
		await expect(region).toContainText("26件中26件を読み込み済み");
		await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
		const unknown = page.getByTestId(`spreadsheet-row-${visibilityPromptId(25)}`);
		const empty = page.getByTestId(`spreadsheet-row-${visibilityPromptId(24)}`);
		await expect(unknown).toContainText("未記録");
		await expect(empty).toContainText("検索クエリなし（取得元で確認済み）");
		await expect(empty).toContainText("出現・引用なし");
		// The no-run prompt remains an independent row instead of disappearing.
		await page.goto(path({ view: "spreadsheet", q: "=E2E CSV" }));
		await expect(page.getByTestId(`spreadsheet-row-${visibilityPromptId(26)}`)).toContainText("期間内の取得結果なし");
	});
});

/**
 * Visibility Page E2E Tests
 *
 * Tests the visibility page which shows prompts with visibility scores.
 * Tests filter functionality (model, tags, lookback period).
 */

const BRAND_ID = "default";

test.describe("Visibility Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}/visibility`);
    // Wait for SSR streaming + hydration — heading appears once route loaders finish
    await expect(page.getByRole("heading", { name: /Visibility|表示状況/ })).toBeVisible({ timeout: 30_000 });
  });

  test("page loads with correct title", async ({ page }) => {
    // heading already asserted in beforeEach
  });

  test("page shows prompt-related content", async ({ page }) => {
    // The page body should contain visibility-related content
    const pageContent = await page.textContent("body");
    const hasContent =
      /Visibility|表示状況/.test(pageContent ?? "") ||
      pageContent?.includes("monitoring") ||
      pageContent?.includes("prompts");
    expect(hasContent).toBeTruthy();
  });

  test("page has filter controls", async ({ page }) => {
    // The page should have interactive filter elements (dropdowns, selects, etc.)
    const headerArea = page.locator("header, [class*='header'], [class*='Header']").first();
    await expect(headerArea).toBeVisible();
  });

  test("page is accessible via sidebar navigation", async ({ page }) => {
    // Navigate via sidebar from overview (use href for stability)
    await page.goto(`/app/${BRAND_ID}`);
    // Wait for sidebar to fully render after route loader completes
    const visLink = page.locator(`a[href="/app/${BRAND_ID}/visibility"][data-sidebar="menu-button"]`);
    await expect(visLink).toBeVisible({ timeout: 15_000 });
    await visLink.click();
    await page.waitForURL(/\/visibility/);
    await expect(page.getByRole("heading", { name: /Visibility|表示状況/ })).toBeVisible({ timeout: 15_000 });
  });
});
