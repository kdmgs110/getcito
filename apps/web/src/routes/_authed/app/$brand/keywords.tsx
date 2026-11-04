import { createFileRoute } from "@tanstack/react-router";
import { KeywordAnalysis } from "@/components/search-console/keyword-analysis";
import { validateKeywordSearch } from "@/components/search-console/state";
import { t } from "@/i18n";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";

export const Route = createFileRoute("/_authed/app/$brand/keywords")({
	validateSearch: validateKeywordSearch,
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle(t("keywords.title"), { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{ name: "description", content: t("keywords.description") },
		],
	}),
	component: KeywordsPage,
});
function KeywordsPage() {
	const { brand } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<KeywordAnalysis
			key={brand}
			brandId={brand}
			search={search}
			onSearch={(patch) => navigate({ search: (previous) => ({ ...previous, ...patch }), resetScroll: false })}
		/>
	);
}
