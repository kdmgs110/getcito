import { expect, test } from "@playwright/test";
import {
	CONCURRENT_PROMPT,
	DELETE_PROMPT,
	PAUSED_PROMPT,
	PROMPT_DELETE_BRAND,
	cleanupPromptFixtures,
	insertConcurrentPrompt,
	readPromptFixtureState,
	seedPromptFixtures,
	setPromptDeleteFailure,
} from "../prompt-fixtures";

const ja = !process.env.VITE_APP_LOCALE || /^ja(?:-|$)/i.test(process.env.VITE_APP_LOCALE);
const text = (japanese: string, english: string) => (ja ? japanese : english);
const deleteLabel = (value: string) => `${text("プロンプトを削除", "Delete prompt")}: ${value}`;
const settingsPath = `/app/${PROMPT_DELETE_BRAND}/settings/prompts`;
const saveLabel = text("プロンプトを保存", "Save Prompts");

test.describe("Prompt deletion", () => {
	test.describe.configure({ mode: "serial" });
	test.beforeEach(seedPromptFixtures);
	test.afterEach(async () => {
		await setPromptDeleteFailure(false);
		await cleanupPromptFixtures();
	});

	test("confirms deletion, removes persisted history, and preserves paused prompts and other brands", async ({ page }) => {
		await page.goto(settingsPath);
		await expect(page.getByRole("button", { name: deleteLabel(DELETE_PROMPT), exact: true })).toBeVisible();
		await insertConcurrentPrompt();
		const before = await readPromptFixtureState();
		expect(before.prompts).toHaveLength(4);
		await page.getByRole("button", { name: deleteLabel(DELETE_PROMPT), exact: true }).click();
		// Removing a draft row alone must not destroy persisted history.
		expect(await readPromptFixtureState()).toEqual(before);
		let confirmation = "";
		page.once("dialog", async (dialog) => {
			expect(dialog.type()).toBe("confirm");
			confirmation = dialog.message();
			await dialog.dismiss();
		});
		await page.getByRole("button", { name: saveLabel, exact: true }).click();
		expect(confirmation).toMatch(ja ? /履歴/ : /history/i);
		expect(await readPromptFixtureState()).toEqual(before);
		await expect(page).toHaveURL(new RegExp(`${settingsPath}$`));
		page.once("dialog", (dialog) => dialog.accept());
		await page.getByRole("button", { name: saveLabel, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/app/${PROMPT_DELETE_BRAND}/visibility`));
		const after = await readPromptFixtureState();
		expect(after.prompts).toHaveLength(3);
		expect(after.prompts).toEqual(before.prompts.filter((prompt) => prompt.value !== DELETE_PROMPT));
		expect(after.deletedChildren).toEqual({ runs: 0, citations: 0 });
		await page.goto(settingsPath);
		await expect(page.getByRole("button", { name: deleteLabel(DELETE_PROMPT), exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: deleteLabel(PAUSED_PROMPT), exact: true })).toBeVisible();
		await page.reload();
		await expect(page.getByRole("button", { name: deleteLabel(DELETE_PROMPT), exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: deleteLabel(PAUSED_PROMPT), exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: deleteLabel(CONCURRENT_PROMPT), exact: true })).toBeVisible();
	});

	test("rolls back children when deletion fails and retains the draft for retry", async ({ page }) => {
		await page.goto(settingsPath);
		const before = await readPromptFixtureState();
		await page.getByRole("button", { name: deleteLabel(DELETE_PROMPT), exact: true }).click();
		await setPromptDeleteFailure(true);
		const dialogs: string[] = [];
		page.on("dialog", async (dialog) => {
			dialogs.push(dialog.type());
			await dialog.accept();
		});
		await page.getByRole("button", { name: saveLabel, exact: true }).click();
		await expect.poll(() => dialogs).toEqual(["confirm", "alert"]);
		expect(await readPromptFixtureState()).toEqual(before);
		await expect(page).toHaveURL(new RegExp(`${settingsPath}$`));
		await expect(page.getByRole("button", { name: deleteLabel(DELETE_PROMPT), exact: true })).toHaveCount(0);
		await setPromptDeleteFailure(false);
		await page.getByRole("button", { name: saveLabel, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/app/${PROMPT_DELETE_BRAND}/visibility`));
		expect((await readPromptFixtureState()).deletedChildren).toEqual({ runs: 0, citations: 0 });
	});
});
