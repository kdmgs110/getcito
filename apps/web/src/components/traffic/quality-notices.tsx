import { t } from "@/i18n";
const warningKeys = {
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
