import { emptyTrafficTotals, type TrafficPageRow, type TrafficPages } from "@workspace/lib/analytics";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { PageTrafficTable } from "./page-traffic-table";
import { QualityNotices } from "./quality-notices";
import { TrafficMeasurementContext } from "./traffic-measurement";

vi.mock("./traffic-chart", () => ({
	Composition: () => null,
	Sparkline: () => null,
	formatRatio: () => "10.0%",
}));

const noop = () => {};
function renderRows(rows: TrafficPageRow[]) {
	const data: TrafficPages = {
		rows,
		totalRows: rows.length,
		page: 1,
		pageSize: 10,
		warnings: [],
		fetchedAt: "2026-10-30",
	};
	return renderToStaticMarkup(
		<TrafficMeasurementContext.Provider value="observed_session_start">
			<PageTrafficTable
				data={data}
				hostname="freelance.example.com"
				query=""
				pageScope="ai"
				pageSize={10}
				grain="day"
				from="2026-10-02"
				to="2026-10-29"
				onSearch={noop}
				onScope={noop}
				onPageSize={noop}
				onPage={noop}
				onDetail={noop}
			/>
		</TrafficMeasurementContext.Provider>,
	);
}

describe("entry-page identity presentation", () => {
	it("uses each row's verified hostname for equal paths from different domains", () => {
		const html = renderRows([
			{ hostname: "www.example.com", path: "/", title: "Main", ...emptyTrafficTotals(), trend: [] },
			{ hostname: "content.example.com", path: "/", title: "Content", ...emptyTrafficTotals(), trend: [] },
		]);
		expect(html).toContain('href="https://www.example.com/"');
		expect(html).toContain('href="https://content.example.com/"');
		expect(html).not.toContain('href="https://freelance.example.com/"');
	});
	it("shows the escaped title above an unabridged absolute URL while retaining metrics and detail action", () => {
		const path = `/job_listings/${"long-path-".repeat(20)}`;
		const html = renderRows([
			{ path, title: "開発 <エンジニア> & 募集", ...emptyTrafficTotals(), ai: 13, total: 20, trend: [] },
		]);
		expect(html).toContain(t("traffic.pageIdentity"));
		const title = "開発 &lt;エンジニア&gt; &amp; 募集";
		const url = `https://freelance.example.com${path}`;
		expect(html).toContain(title);
		expect(html).toContain(url);
		expect(html).toContain(`href="${url}"`);
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html.indexOf(title)).toBeLessThan(html.indexOf(url));
		expect(html).not.toContain("truncate");
		expect(html).toContain(">13</td>");
		expect(html).toContain(">20</td>");
		expect(html).toContain(`${t("traffic.viewTrend")}: ${path}`);
	});
	it("preserves a usable URL for missing titles and never fabricates one for an unknown entry path", () => {
		const html = renderRows([
			{ path: "/", title: null, ...emptyTrafficTotals(), trend: [] },
			{ path: "(not set)", ...emptyTrafficTotals(), trend: [] },
		]);
		expect(html).toContain(t("traffic.titleUnavailable"));
		expect(html).toContain("https://freelance.example.com/");
		expect(html).toContain(t("traffic.observed.unavailablePath"));
		expect(html).not.toContain("https://freelance.example.com(not set)");
		expect(html.match(/<a /g)).toHaveLength(1);
	});
	it("explains a title lookup failure without implying traffic counts were lost", () => {
		const html = renderToStaticMarkup(<QualityNotices warnings={["page_titles_unavailable"]} />);
		expect(html).toContain(t("traffic.pageTitlesUnavailable"));
		expect(html).not.toContain(t("traffic.qualityGeneric"));
	});
});
