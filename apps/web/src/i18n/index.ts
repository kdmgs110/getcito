import { createTranslator } from "@workspace/ui/lib/i18n";
import { APP_LOCALE } from "@/lib/app-locale";
import { conversionMessages } from "./messages/conversions";
import { coreMessages } from "./messages/core";
import { dashboardMessages } from "./messages/dashboard";
import { reportMessages } from "./messages/reports";
import { settingsMessages } from "./messages/settings";
import { trafficMessages } from "./messages/traffic";

export { APP_LANGUAGE, createTranslator, resolveLanguage } from "@workspace/ui/lib/i18n";
export const messages = {
	...coreMessages,
	...dashboardMessages,
	...settingsMessages,
	...reportMessages,
	...trafficMessages,
	...conversionMessages,
};
export const t = createTranslator(messages);
export const UI_LOCALE = APP_LOCALE;
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(UI_LOCALE, options).format(value);
}
