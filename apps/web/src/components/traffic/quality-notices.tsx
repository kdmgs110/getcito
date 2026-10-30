import { t } from "@/i18n";

const warningKeys = {
	page_titles_unavailable: "traffic.pageTitlesUnavailable",
	conversion_landing_unavailable: "conversions.pageUnsupported",
	conversion_landing_unset: "conversions.landingUnset",
	conversion_rate_metric_unavailable: "conversions.cvrUnavailable",
	conversion_rate_unavailable: "conversions.cvrUnavailable",
	conversion_sessions_unavailable: "conversions.sessionsUnavailable",
	conversion_before_registration: "conversions.beforeRegistration",
	conversion_rate_quality_unavailable: "conversions.cvrUnavailable",
	stale_cache: "traffic.staleCache",
	data_loss_other: "traffic.dataLoss",
	data_thresholding: "traffic.thresholding",
	data_sampling: "traffic.sampling",
	data_truncated: "traffic.truncated",
	inconsistent_totals: "traffic.inconsistent",
} as const;
export function QualityNotices({ warnings }: { warnings: string[] }) {
	const qualityWarnings = warnings.filter((warning) => warning !== "observed_session_start");
	if (!qualityWarnings.length) return null;
	return (
		<div
			role="status"
			className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
		>
			<p className="font-medium">{t("traffic.quality")}</p>
			<ul className="mt-2 list-inside list-disc space-y-1 text-xs">
				{[...new Set(qualityWarnings)].map((warning) => (
					<li key={warning}>{t(warningKeys[warning as keyof typeof warningKeys] ?? "traffic.qualityGeneric")}</li>
				))}
			</ul>
		</div>
	);
}
