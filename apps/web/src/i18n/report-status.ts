import { t } from "@/i18n";

/** Translate the display label without changing the stored workflow status. */
export function reportStatusLabel(status: string): string {
	switch (status) {
		case "completed":
			return t("reports.completed");
		case "processing":
			return t("reports.processing");
		case "failed":
			return t("reports.failed");
		case "pending":
			return t("reports.pending");
		case "active":
			return t("reports.active");
		case "created":
			return t("reports.created");
		case "retry":
			return t("reports.retry");
		default:
			return t("reports.unknown");
	}
}
