import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
	emptyTrafficTotals,
	type AnalyticsMeasurementMode,
	type TrafficOverview,
	type TrafficPages,
} from "@workspace/lib/analytics";
import { t } from "@/i18n";
import { TrafficKpis, TrafficPeriodTable } from "./traffic-chart";
import { PageTrafficTable } from "./page-traffic-table";
import { QualityNotices } from "./quality-notices";
import { MeasurementNotice, TrafficMeasurementContext } from "./traffic-measurement";
import { conditionsSummary } from "./condition-editor";

const overview: TrafficOverview = {
	points: [],
	totals: emptyTrafficTotals(),
	warnings: [],
	fetchedAt: "2026-10-30T00:00:00Z",
	timeZone: "Asia/Tokyo",
};
const pages: TrafficPages = {
	rows: [],
	totalRows: 0,
	page: 1,
	pageSize: 10,
	warnings: [],
	fetchedAt: overview.fetchedAt,
};
function reportMarkup(mode: AnalyticsMeasurementMode) {
	return renderToStaticMarkup(
		<TrafficMeasurementContext.Provider value={mode}>
			<MeasurementNotice mode={mode} />
			<TrafficKpis totals={overview.totals} />
			<TrafficPeriodTable data={overview} grain="day" from="2026-10-01" to="2026-10-28" onGrainChange={() => {}} />
			<PageTrafficTable
				data={pages}
				hostname="example.com"
				query=""
				pageScope="ai"
				pageSize={10}
				grain="day"
				from="2026-10-01"
				to="2026-10-28"
				onSearch={() => {}}
				onScope={() => {}}
				onPageSize={() => {}}
				onPage={() => {}}
				onDetail={() => {}}
			/>
		</TrafficMeasurementContext.Provider>,
	);
}
describe("traffic measurement semantics", () => {
	it("keeps the standard landing-session report labels and omits the special-mode notice", () => {
		const markup = reportMarkup("landing_sessions");
		expect(markup).toContain(t("traffic.total"));
		expect(markup).toContain(t("traffic.periodTable"));
		expect(markup).toContain(t("traffic.pageTableHelp"));
		expect(markup).not.toContain(t("traffic.observed.noticeTitle"));
		expect(conditionsSummary([])).toBe(t("traffic.allPaths"));
	});
	it("identifies recorded starts throughout the report and explains missing start events", () => {
		const markup = reportMarkup("observed_session_start");
		for (const key of [
			"traffic.observed.noticeTitle",
			"traffic.observed.ai",
			"traffic.observed.total",
			"traffic.observed.periodTable",
			"traffic.observed.pageTable",
			"traffic.observed.pageTableHelp",
			"traffic.pageIdentity",
		] as const) {
			expect(markup).toContain(t(key));
		}
		expect(markup).toContain("session_start");
		expect(markup).toContain("GA4");
		expect(markup).not.toContain(t("traffic.pageTableHelp"));
		expect(conditionsSummary([], "observed_session_start")).toBe(t("traffic.observed.allPaths"));
	});
	it("shows the mode explanation once without hiding real data-quality warnings", () => {
		expect(renderToStaticMarkup(<QualityNotices warnings={["observed_session_start"]} />)).toBe("");
		const markup = renderToStaticMarkup(<QualityNotices warnings={["observed_session_start", "data_sampling"]} />);
		expect(markup).toContain(t("traffic.sampling"));
		expect(markup).not.toContain(t("traffic.qualityGeneric"));
	});
});
