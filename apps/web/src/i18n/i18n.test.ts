import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator, resolveLanguage } from "@workspace/ui/lib/i18n";
import { messages } from "./index";

const placeholders = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("translation catalog", () => {
	it("provides Japanese and matching interpolation parameters for every message", () => {
		for (const [key, entry] of Object.entries(messages)) {
			expect(entry.en.trim(), key).not.toBe("");
			expect(entry.ja.trim(), key).not.toBe("");
			expect(placeholders(entry.ja), key).toEqual(placeholders(entry.en));
		}
	});
	it("uses Japanese by default and keeps unsupported locales on English", () => {
		expect(resolveLanguage()).toBe("ja");
		expect(resolveLanguage(" ja-JP ")).toBe("ja");
		expect(resolveLanguage("en-US")).toBe("en");
		expect(resolveLanguage("fr-FR")).toBe("en");
	});
	it("falls back to English and inserts values without interpreting them as markup", () => {
		const translate = createTranslator({ count: { en: "{count} results for {name}" } }, "ja");
		expect(translate("count", { count: 0, name: "<script>" })).toBe("0 results for <script>");
		expect(translate("count", { count: 2 })).toBe("2 results for {name}");
	});
	it("renders the same configured language on the server and in shared UI", async () => {
		vi.stubEnv("VITE_APP_LOCALE", "en-US");
		const { t, APP_LANGUAGE } = await import("./index");
		const { uiT } = await import("@workspace/ui/lib/i18n");
		expect(APP_LANGUAGE).toBe("en");
		expect(t("core.apply")).toBe("Apply");
		expect(uiT("close")).toBe("Close");
	});
	it("preserves the configured regional number format when the UI falls back to English", async () => {
		vi.stubEnv("VITE_APP_LOCALE", "en-IN");
		const { APP_LANGUAGE, formatNumber } = await import("./index");
		expect(APP_LANGUAGE).toBe("en");
		expect(formatNumber(1234567)).toBe("12,34,567");
	});
	it("escapes interpolated user content when rendered by React", async () => {
		const React = await import("react");
		const translate = createTranslator({ name: { en: "{name}", ja: "{name}" } }, "ja");
		expect(renderToStaticMarkup(React.createElement("span", null, translate("name", { name: "<script>" })))).toBe(
			"<span>&lt;script&gt;</span>",
		);
	});
});
