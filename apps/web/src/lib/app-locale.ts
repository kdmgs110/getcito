/**
 * Keep charts, admin tables, and server-side daily aggregates on the same calendar.
 * Deployments can pin both values; local development follows the runtime defaults.
 *
 * This module deliberately imports nothing — both `chart-utils` and `timezone-utils`
 * depend on it, and they already depend on each other.
 */
export const APP_TIMEZONE =
	import.meta.env.VITE_APP_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const APP_LOCALE = import.meta.env.VITE_APP_LOCALE?.trim() || "ja-JP";

/** Format an absolute instant (a stored timestamp) in the app's timezone. */
export function formatDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
	return new Date(value).toLocaleString(APP_LOCALE, { timeZone: APP_TIMEZONE, ...options });
}

/**
 * Format a `YYYY-MM-DD` calendar date — a day bucket the server already resolved in
 * the app's timezone, not an instant. Built from its parts rather than parsed, because
 * `new Date("2026-01-15")` is UTC midnight and would render as the 14th for any viewer
 * west of Greenwich; there is no instant to convert here, only a day to print.
 */
export function formatDateStr(dateStr: string, options: Intl.DateTimeFormatOptions): string {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString(APP_LOCALE, options);
}

/** Today in the app's timezone, as `YYYY-MM-DD` ("en-CA" is the ISO-shaped locale). */
export function todayDateStr(now: Date = new Date()): string {
	return now.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}
