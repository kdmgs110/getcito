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
import { ConversionKpis, ConversionNotices, ConversionPages, ConversionTrend } from "./conversion-analysis";
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

function renderPages(rows: ConversionReport["pages"]["rows"]) {
	const report: ConversionReport = {
		totals: metrics,
		points: [],
		sources: [],
		pages: { rows, totalRows: rows.length, page: 1, pageSize: 10 },
		measurementScope: "cv_event_host",
		pageAttributionSupported: true,
		cvrSupported: false,
		warnings: [],
		fetchedAt: "2026-10-31T00:00:00Z",
		timeZone: "Asia/Tokyo",
	};
	return renderToStaticMarkup(<ConversionPages report={report} search={{}} onSearch={() => {}} onDetail={() => {}} />);
}

describe("conversion page identity presentation", () => {
	it("shows the escaped title above a full URL that opens in a separate tab, retaining counts and trend action", () => {
		const path = `/articles/${"long-path-".repeat(20)}`;
		const html = renderPages([
			{ ...metrics, path, trend: [], pageIdentities: [{ hostname: "www.example.com", title: "物販 <入門> & 解説" }] },
		]);
		const title = "物販 &lt;入門&gt; &amp; 解説";
		const url = `https://www.example.com${path}`;
		expect(html).toContain(t("traffic.pageIdentity"));
		expect(html).toContain(title);
		expect(html).toContain(`href="${url}"`);
		expect(html.indexOf(title)).toBeLessThan(html.indexOf(url));
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).not.toContain("truncate");
		expect(html).toContain(">5</td>");
		expect(html).toContain(">20</td>");
		expect(html).toContain(`${t("conversions.detail")}: ${path}`);
	});

	it("shows all observed domains for a shared path without duplicating its conversion counts", () => {
		const html = renderPages([
			{
				...metrics,
				path: "/",
				trend: [],
				pageIdentities: [
					{ hostname: "www.example.com", title: "Main" },
					{ hostname: "content.example.com", title: "Content" },
				],
			},
		]);
		expect(html).toContain('href="https://www.example.com/"');
		expect(html).toContain('href="https://content.example.com/"');
		expect(html).toContain(t("conversions.sharedPathPages"));
		expect(html.match(/>20<\/td>/g)).toHaveLength(1);
	});

	it("retains a known URL when the title is absent and avoids invented links when page metadata is missing", () => {
		const html = renderPages([
			{ ...metrics, path: "/known", trend: [], pageIdentities: [{ hostname: "www.example.com", title: null }] },
			{ ...metrics, path: "/unknown", trend: [] },
			{ ...metrics, path: "(not set)", trend: [] },
		]);
		expect(html).toContain(t("traffic.titleUnavailable"));
		expect(html).toContain('href="https://www.example.com/known"');
		expect(html).toContain("/unknown");
		expect(html).toContain("(not set)");
		expect(html.match(/<a /g)).toHaveLength(1);
		expect(html).toContain('disabled=""');
	});
});
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
	it("renders the requested AI session count and session-based CVR together", () => {
		const html = renderToStaticMarkup(
			<ConversionKpis
				metrics={{ ...metrics, aiSessions: 552, aiCv: 8, aiCvSessions: 8, aiCvr: 8 / 552 }}
				cvrSupported
			/>,
		);
		expect(html).toContain(t("conversions.aiSessions"));
		expect(html).toContain("552");
		expect(html).toContain("1.45%");
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
