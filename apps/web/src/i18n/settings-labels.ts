import { marketCountryCode } from "@workspace/lib/locations";
import { APP_LANGUAGE, t } from "@/i18n";

/** Localize labels only: provider-facing country and language values stay unchanged. */
export function displayMarket(name: string, language = APP_LANGUAGE): string {
	const code = marketCountryCode(name);
	if (language === "en" || !code) return name;
	return new Intl.DisplayNames([language], { type: "region" }).of(code.toUpperCase()) ?? name;
}

export function displayLanguage(code: string, name: string, language = APP_LANGUAGE): string {
	if (language === "en") return name;
	try {
		return new Intl.DisplayNames([language], { type: "language" }).of(code) ?? name;
	} catch {
		return name;
	}
}

/** Keep diagnostic details for English deployments; Japanese users get an actionable localized message. */
export function settingsError(error: unknown, fallback: string): string {
	if (APP_LANGUAGE === "en" && error instanceof Error && error.message) return error.message;
	return fallback;
}

export function authErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
	switch (error.code) {
		case "INVALID_EMAIL_OR_PASSWORD":
		case "USER_NOT_FOUND":
		case "CREDENTIAL_ACCOUNT_NOT_FOUND":
			return t("settings.invalidEmailOrPassword");
		case "USER_ALREADY_EXISTS":
		case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
			return t("settings.authAlreadyExists");
		case "PASSWORD_TOO_SHORT":
			return t("settings.authPasswordShort");
		case "PASSWORD_TOO_LONG":
			return t("settings.authPasswordLong");
		case "INVALID_EMAIL":
			return t("settings.authInvalidEmail");
		case "EMAIL_NOT_VERIFIED":
			return t("settings.authEmailUnverified");
		case "TOO_MANY_REQUESTS":
			return t("settings.authRateLimit");
		default:
			return APP_LANGUAGE === "en" ? error.message || fallback : fallback;
	}
}

/** System-generated tags may be translated; user-created tag text is always preserved. */
export function displaySystemTag(value: string): string {
	switch (value) {
		case "branded":
			return t("settings.tagBranded");
		case "unbranded":
			return t("settings.tagUnbranded");
		default:
			return value;
	}
}
