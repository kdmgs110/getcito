import { t } from "@/i18n";
/**
 * Coarse duration formatting for the admin monitoring pages.
 *
 * Only the two largest units are ever shown ("2d 4h", "3h 20m"): these read as
 * "how far behind is this", where a minute either way changes nothing.
 */
export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	const weeks = Math.floor(days / 7);

	if (weeks > 0) {
		const remainingDays = days % 7;
		return remainingDays > 0
			? `${t("core.durationWeeks", { value: weeks })} ${t("core.durationDays", { value: remainingDays })}`
			: `${t("core.durationWeeks", { value: weeks })}`;
	}
	if (days > 0) {
		const remainingHours = hours % 24;
		return remainingHours > 0
			? `${t("core.durationDays", { value: days })} ${t("core.durationHours", { value: remainingHours })}`
			: `${t("core.durationDays", { value: days })}`;
	}
	if (hours > 0) {
		const remainingMinutes = minutes % 60;
		return remainingMinutes > 0
			? `${t("core.durationHours", { value: hours })} ${t("core.durationMinutes", { value: remainingMinutes })}`
			: `${t("core.durationHours", { value: hours })}`;
	}
	if (minutes > 0) return `${t("core.durationMinutes", { value: minutes })}`;
	return `${t("core.durationSeconds", { value: seconds })}`;
}

/**
 * Precise duration for provider-call latency, where `formatDuration`'s coarse
 * units would round every AI call down to "0s" or "1m". Sub-minute values keep
 * one decimal; anything longer falls back to the coarse form.
 */
export function formatLatency(ms: number | null | undefined): string {
	if (ms == null) return "—";
	if (ms < 1000) return t("core.durationMilliseconds", { value: Math.round(ms) });
	if (ms < 60_000) return t("core.durationSeconds", { value: (ms / 1000).toFixed(1) });
	return formatDuration(ms);
}

export function formatRelativeTime(dateStr: string | null): string {
	if (!dateStr) return t("core.never");
	const diffMs = Date.now() - new Date(dateStr).getTime();
	return t("core.relativePast", { duration: formatDuration(diffMs) });
}

export function formatFutureTime(timestamp: number | null): string {
	if (!timestamp) return t("core.unknown");
	const diffMs = timestamp - Date.now();
	if (diffMs < 0) return t("core.overdue");
	return t("core.relativeFuture", { duration: formatDuration(diffMs) });
}
