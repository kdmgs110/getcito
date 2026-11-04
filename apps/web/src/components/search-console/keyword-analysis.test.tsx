import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultSearchConsoleDates, GSC_FILTER_VERSION } from "@workspace/lib/search-console";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { KeywordAnalysis } from "./keyword-analysis";
import type { KeywordSearch } from "./state";
import { parseUrlConditions } from "./state";

vi.mock("@/server/search-console", () => ({
	getSearchConsoleStatusFn: vi.fn(),
	getSearchConsoleReportFn: vi.fn(),
	getSearchConsolePropertiesFn: vi.fn(),
	beginSearchConsoleOAuthFn: vi.fn(),
	connectSearchConsolePropertyFn: vi.fn(),
	disconnectSearchConsoleFn: vi.fn(),
}));

function renderReport(search: KeywordSearch = {}, needsReauth = false) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const dates = defaultSearchConsoleDates();
	const filters = {
		...dates,
		keyword: search.keyword ?? "",
		aiQuestionsOnly: search.aiQuestionsOnly ?? false,
		urlConditions: parseUrlConditions(search.urlConditions ?? "[]") ?? [],
	};
	client.setQueryData(["gsc-status", "brand"], {
		configured: true,
		canManage: true,
		oauthConnected: true,
		needsReauth,
		propertyId: "https://example.com/",
		connectionRevision: "revision",
	});
	client.setQueryData(["gsc-report", "brand", "https://example.com/", "revision", filters, GSC_FILTER_VERSION], {
		rows: [
			{ query: "検索語を確認するテスト", clicks: 30, impressions: 1000, ctr: 0.03, position: 5.2 },
			...(filters.aiQuestionsOnly ? [{ query: "案件を教えて", clicks: 0, impressions: 1, ctr: 0, position: 5 }] : []),
		],
		totals: { clicks: 30, impressions: 1000, ctr: 0.03, position: 5.2 },
		fetchedAt: "2026-11-05T00:00:00Z",
		truncated: false,
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<KeywordAnalysis brandId="brand" search={{ ...dates, ...search }} onSearch={() => {}} />
		</QueryClientProvider>,
	);
}

describe("keyword analysis report states", () => {
	it("starts with AI filtering off and identifies the heuristic while presenting real search metrics", () => {
		const html = renderReport();
		expect(html).toContain("検索語を確認するテスト");
		expect(html).toContain('aria-checked="false"');
		expect(html).toContain(t("keywords.aiNote"));
		expect(html).toContain("3.00%");
		expect(html).toContain(t("keywords.export"));
	});
	it("does not display cached all-keyword results for invalid URL filters", () => {
		const html = renderReport({ invalidFilters: true });
		expect(html).toContain(t("keywords.invalid"));
		expect(html).not.toContain("検索語を確認するテスト");
	});
	it("defaults AI candidates to heuristic priority and exposes the matching reason and four-term condition", () => {
		const html = renderReport({ aiQuestionsOnly: true });
		expect(html.indexOf("案件を教えて")).toBeLessThan(html.indexOf("検索語を確認するテスト"));
		expect(html).toContain(t("keywords.reason.request"));
		expect(html).toContain(t("keywords.aiSort"));
		expect(html).toContain(t("keywords.aiHelp"));
		expect(html).toContain('aria-pressed="true"');
	});
	it("hides cached report data when the connection needs reauthorization", () => {
		const html = renderReport({}, true);
		expect(html).toContain(t("keywords.reauth"));
		expect(html).not.toContain("検索語を確認するテスト");
		expect(html).not.toContain(t("keywords.connected"));
	});
});
