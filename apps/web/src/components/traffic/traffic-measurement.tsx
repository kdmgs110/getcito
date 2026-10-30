import { createContext, useContext } from "react";
import type { AnalyticsMeasurementMode } from "@workspace/lib/analytics";
import { t } from "@/i18n";

export const TrafficMeasurementContext = createContext<AnalyticsMeasurementMode>("landing_sessions");

/** Keep every report surface explicit about the metric represented by its counts. */
export function trafficMeasurementLabels(mode: AnalyticsMeasurementMode = "landing_sessions") {
	const observed = mode === "observed_session_start";
	return {
		observed,
		ai: t(observed ? "traffic.observed.ai" : "traffic.ai"),
		total: t(observed ? "traffic.observed.total" : "traffic.total"),
		ratio: t(observed ? "traffic.observed.ratio" : "traffic.ratio"),
		sessions: t(observed ? "traffic.observed.sessions" : "traffic.sessions"),
		aiTotal: t(observed ? "traffic.observed.aiTotal" : "traffic.aiTotal"),
		trend: t(observed ? "traffic.observed.trend" : "traffic.trend"),
		periodTable: t(observed ? "traffic.observed.periodTable" : "traffic.periodTable"),
		pageTable: t(observed ? "traffic.observed.pageTable" : "traffic.pageTable"),
		pageTableHelp: t(observed ? "traffic.observed.pageTableHelp" : "traffic.pageTableHelp"),
		path: t(observed ? "traffic.observed.path" : "traffic.path"),
		allPaths: t(observed ? "traffic.observed.allPaths" : "traffic.allPaths"),
		allPages: t(observed ? "traffic.observed.allPaths" : "traffic.allPages"),
		aiPages: t(observed ? "traffic.observed.aiPages" : "traffic.aiPages"),
		pageDetail: t(observed ? "traffic.observed.pageDetail" : "traffic.pageDetail"),
		targetPages: t(observed ? "traffic.observed.targetPages" : "traffic.targetPages"),
		unavailablePath: t(observed ? "traffic.observed.unavailablePath" : "traffic.unavailablePath"),
		measurementNote: t(observed ? "traffic.observed.measurementNote" : "traffic.measurementNote"),
	};
}
export function useTrafficMeasurement() {
	const mode = useContext(TrafficMeasurementContext);
	return { mode, ...trafficMeasurementLabels(mode) };
}
export function MeasurementNotice({ mode }: { mode: AnalyticsMeasurementMode }) {
	if (mode !== "observed_session_start") return null;
	return (
		<aside
			className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
			aria-label={t("traffic.observed.noticeTitle")}
		>
			<p className="text-sm font-semibold">{t("traffic.observed.noticeTitle")}</p>
			<p className="mt-2 text-pretty text-sm leading-relaxed">{t("traffic.observed.noticeDescription")}</p>
		</aside>
	);
}
