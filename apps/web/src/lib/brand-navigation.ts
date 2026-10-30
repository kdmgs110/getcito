import { validDateRange } from "@/components/traffic/traffic-state";

const brandRoutes = {
	"": "/app/$brand",
	traffic: "/app/$brand/traffic",
	visibility: "/app/$brand/visibility",
	"share-of-voice": "/app/$brand/share-of-voice",
	"query-fan-out": "/app/$brand/query-fan-out",
	citations: "/app/$brand/citations",
	opportunities: "/app/$brand/opportunities",
	"settings/brand": "/app/$brand/settings/brand",
	"settings/competitors": "/app/$brand/settings/competitors",
	"settings/prompts": "/app/$brand/settings/prompts",
	"settings/llms": "/app/$brand/settings/llms",
} as const;

export type BrandSection = keyof typeof brandRoutes;
export type BrandReturnSearch = { returnBrand?: string; returnSection?: BrandSection };

export function validateBrandReturnSearch(search: Record<string, unknown>): BrandReturnSearch {
	return {
		returnBrand:
			typeof search.returnBrand === "string" &&
			search.returnBrand.length <= 200 &&
			/^[a-zA-Z0-9_-]+$/.test(search.returnBrand)
				? search.returnBrand
				: undefined,
		returnSection:
			typeof search.returnSection === "string" && Object.hasOwn(brandRoutes, search.returnSection)
				? (search.returnSection as BrandSection)
				: undefined,
	};
}

export function getBrandSection(pathname: string, brandId: string): BrandSection {
	const base = `/app/${encodeURIComponent(brandId)}`;
	const section =
		pathname === base || pathname === `${base}/`
			? ""
			: pathname.startsWith(`${base}/`)
				? pathname.slice(base.length + 1).replace(/\/$/, "")
				: "";
	return Object.hasOwn(brandRoutes, section) ? (section as BrandSection) : "";
}

/** Only carry portable display preferences. Never copy a saved view, CV, page, or filter between brands. */
export function makeBrandDestination(
	brandId: string,
	section: BrandSection = "",
	previous: Record<string, unknown> = {},
	onboarded = true,
) {
	const aiSections: readonly string[] = ["visibility", "share-of-voice", "query-fan-out", "citations", "opportunities"];
	const target = !onboarded && aiSections.includes(section) ? "" : section;
	const search: {
		from?: string;
		to?: string;
		grain?: "day" | "week" | "month";
		chart?: "total" | "sources";
		analysisTab?: "traffic" | "conversions";
	} = {};
	if (target === "traffic") {
		if (
			typeof previous.from === "string" &&
			typeof previous.to === "string" &&
			validDateRange(previous.from, previous.to)
		) {
			search.from = previous.from;
			search.to = previous.to;
		}
		if (previous.grain === "day" || previous.grain === "week" || previous.grain === "month")
			search.grain = previous.grain;
		if (previous.chart === "total" || previous.chart === "sources") search.chart = previous.chart;
		if (previous.analysisTab === "traffic" || previous.analysisTab === "conversions")
			search.analysisTab = previous.analysisTab;
	}
	return { to: brandRoutes[target], params: { brand: brandId }, search };
}

export function brandDomain(website?: string | null): string {
	if (!website) return "";
	try {
		return new URL(website.includes("://") ? website : `https://${website}`).hostname;
	} catch {
		return website;
	}
}
