import { test, expect } from "@playwright/test";
import { TEST_BRAND_NAME, TEST_REPORT_ID } from "../seed";

const japanese = !process.env.VITE_APP_LOCALE || /^ja(?:-|$)/i.test(process.env.VITE_APP_LOCALE);

test.describe("Localized UI", () => {
  test("uses the configured language in SSR, navigation, and metadata", async ({ page, request }) => {
    const response = await request.get("/auth/login");
    expect(await response.text()).toContain(`lang="${japanese ? "ja" : "en"}"`);
    await page.goto("/app/default");
    await expect(page.locator("html")).toHaveAttribute("lang", japanese ? "ja" : "en");
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", japanese ? "ja_JP" : "en_US");
    await expect(page.locator('a[href="/app/default"][data-sidebar="menu-button"]')).toHaveText(japanese ? "概要" : "Overview");
    await expect(page.locator("body")).not.toContainText(/%\s*%/);
  });

  test("saves Japanese user input through localized brand settings", async ({ page }) => {
    await page.goto("/app/default/settings/brand");
    const description = page.getByLabel(japanese ? "概要" : "Short Description", { exact: true });
    const value = "日本語のブランド説明（E2E）";
    await description.fill(value);
    await page.getByRole("button", { name: japanese ? "変更を保存" : "Save Changes", exact: true }).click();
    await expect(page.getByRole("button", { name: japanese ? "変更を保存" : "Save Changes", exact: true })).toBeEnabled();
    await page.reload();
    await expect(description).toHaveValue(value);
    await expect(page.getByLabel(japanese ? "ブランド名" : "Brand Name", { exact: true })).toHaveValue(TEST_BRAND_NAME);
  });

  test("renders completed printable reports with original brand data", async ({ page }) => {
    await page.goto(`/reports/render/${TEST_REPORT_ID}`);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("heading", { name: TEST_BRAND_NAME, exact: true }).first()).toBeVisible();
    await expect(page.locator("body")).toContainText(japanese ? "シェア・オブ・ボイス" : "Share of Voice");
    await expect(page.locator("body")).not.toContainText(/reports\.[a-zA-Z]/);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans JP"'))).toBe(true);
  });

  test("renders an OG image with Japanese text", async ({ request }) => {
    const response = await request.get("/api/og?title=" + encodeURIComponent("日本語のブランド分析"));
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    const png = await response.body();
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

test.describe("Localized authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("shows a localized authentication error", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel(japanese ? "メールアドレス" : "Email", { exact: true }).fill("e2e@test.local");
    await page.getByLabel(japanese ? "パスワード" : "Password", { exact: true }).fill("incorrect-password");
    await page.getByRole("button", { name: japanese ? "ログイン" : "Sign in", exact: true }).click();
    await expect(page.getByText(japanese ? "メールアドレスまたはパスワードが正しくありません" : "Invalid email or password", { exact: false })).toBeVisible();
  });
});
