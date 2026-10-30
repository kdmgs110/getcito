import { APP_LOCALE } from "@/lib/app-locale";
import { createTranslator } from "@workspace/ui/lib/i18n";
import { coreMessages } from "./messages/core";
import { dashboardMessages } from "./messages/dashboard";
import { settingsMessages } from "./messages/settings";
import { reportMessages } from "./messages/reports";

export { APP_LANGUAGE, createTranslator, resolveLanguage } from "@workspace/ui/lib/i18n";
export const messages = { ...coreMessages, ...dashboardMessages, ...settingsMessages, ...reportMessages };
export const t = createTranslator(messages);
export const UI_LOCALE = APP_LOCALE;
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(UI_LOCALE, options).format(value);
}
