import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("app locale configuration", () => {
	it("uses deployment-provided locale and timezone", async () => {
		vi.stubEnv("VITE_APP_TIMEZONE", "America/New_York");
		vi.stubEnv("VITE_APP_LOCALE", "fr-FR");

		const { APP_LOCALE, APP_TIMEZONE } = await import("@/lib/app-locale");

		expect(APP_TIMEZONE).toBe("America/New_York");
		expect(APP_LOCALE).toBe("fr-FR");
	});

	it("defaults to Japanese and the runtime timezone when configuration is blank", async () => {
		vi.stubEnv("VITE_APP_TIMEZONE", "");
		vi.stubEnv("VITE_APP_LOCALE", "");

		const { APP_LOCALE, APP_TIMEZONE } = await import("@/lib/app-locale");

		expect(APP_TIMEZONE).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
		expect(APP_LOCALE).toBe("ja-JP");
	});
});
