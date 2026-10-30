import { describe, expect, it } from "vitest";
import { authErrorMessage, displayLanguage, displayMarket, displaySystemTag } from "./settings-labels";
import { t } from "./index";

describe("localized setting labels", () => {
	it("localizes provider country and language labels without changing unknown data", () => {
		expect(displayMarket("Japan", "ja")).toBe("日本");
		expect(displayMarket("Japan", "en")).toBe("Japan");
		expect(displayMarket("A custom location", "ja")).toBe("A custom location");
		expect(displayLanguage("en", "English", "ja")).toBe("英語");
		expect(displayLanguage("en", "English", "en")).toBe("English");
	});

	it("maps authentication error codes to user-facing messages", () => {
		expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Raw provider error" }, "fallback")).toBe(
			t("settings.invalidEmailOrPassword"),
		);
		expect(authErrorMessage({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }, "fallback")).toBe(
			t("settings.authAlreadyExists"),
		);
	});

	it("preserves custom tag names while translating system tags", () => {
		expect(displaySystemTag("branded")).toBe(t("settings.tagBranded"));
		expect(displaySystemTag("My custom tag")).toBe("My custom tag");
	});
});
