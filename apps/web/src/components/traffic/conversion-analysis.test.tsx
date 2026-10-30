import type { ConversionMetrics, ConversionReport } from "@workspace/lib/analytics";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/conversions", () => ({
	getConversionReportFn: vi.fn(),
	listConversionGoalsFn: vi.fn(),
	listConversionEventsFn: vi.fn(),
	saveConversionGoalFn: vi.fn(),
}));

import { t } from "@/i18n";
import { ConversionKpis, ConversionNotices, ConversionTrend } from "./conversion-analysis";
import { SavedViewSwitcher } from "./saved-view-switcher";
import { TrafficMeasurementContext } from "./traffic-measurement";

const metrics: ConversionMetrics = {
	cv: 20,
	aiCv: 5,
	sessions: null,
	aiSessions: null,
	cvSessions: null,
	aiCvSessions: null,
	cvr: null,
	aiCvr: null,
};
describe("conversion measurement presentation", () => {
	it("never renders an unsupported conversion rate as zero", () => {
		const html = renderToStaticMarkup(<ConversionKpis metrics={{ ...metrics, aiCvr: 0 }} cvrSupported={false} />);
		expect(html).toContain(t("conversions.aiCvr"));
		expect(html).toContain("—");
		expect(html).not.toContain("0.00%");
	});
	it("shows a verified zero rate and separates event counts from converted sessions", () => {
		const html = renderToStaticMarkup(
			<ConversionKpis metrics={{ ...metrics, aiSessions: 10, aiCvSessions: 3, aiCvr: 0 }} cvrSupported />,
		);
		expect(html).toContain("0.00%");
		expect(html).toContain(t("conversions.aiCvSessions"));
		expect(html).toContain(": 3");
	});
	it("explains unknown landing host and unavailable denominators for observed mode", () => {
		const report = {
			measurementScope: "cv_event_host",
			pageAttributionSupported: true,
			cvrSupported: false,
			warnings: ["cv_event_host", "cross_host_landing_unverified", "cvr_scope_unavailable"],
		} as ConversionReport;
		const html = renderToStaticMarkup(<ConversionNotices report={report} />);
		expect(html).toContain(t("conversions.hostScope"));
		expect(html).toContain(t("conversions.crossHost"));
		expect(html).toContain(t("conversions.cvrUnavailable"));
		expect(html).not.toContain(t("traffic.qualityGeneric"));
	});
});

describe("conversion saved-view labels", () => {
	it("does not qualify conversion paths as recorded session_start events", () => {
		const noop = () => {};
		const html = renderToStaticMarkup(
			<TrafficMeasurementContext.Provider value="observed_session_start">
				<SavedViewSwitcher
					views={[]}
					hostname="example.com"
					dirty={false}
					canManage={false}
					allPathsLabel={t("conversions.allPaths")}
					onSelect={noop}
					onCreate={noop}
					onManage={noop}
					onSave={noop}
					onRestore={noop}
				/>
			</TrafficMeasurementContext.Provider>,
		);
		expect(html).toContain(t("conversions.allPaths"));
		expect(html).not.toContain(t("traffic.observed.allPaths"));
	});
});

describe("conversion trend legend", () => {
	it("identifies the all-source dashed line separately from the AI total", () => {
		const html = renderToStaticMarkup(<ConversionTrend points={[]} cvrSupported={false} />);
		expect(html).toContain(t("conversions.allCv"));
		expect(html).toContain("border-dashed");
		expect(html).toContain(t("conversions.aiCv"));
	});
});
