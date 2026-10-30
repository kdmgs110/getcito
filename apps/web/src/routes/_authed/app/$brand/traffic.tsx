import { createFileRoute } from "@tanstack/react-router";
import { TrafficAnalysis } from "@/components/traffic/traffic-analysis";
import { validateTrafficSearch } from "@/components/traffic/traffic-state";
import { t } from "@/i18n";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
export const Route = createFileRoute("/_authed/app/$brand/traffic")({
	validateSearch: validateTrafficSearch,
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle(t("traffic.title"), { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{ name: "description", content: t("traffic.description") },
		],
	}),
	component: TrafficPage,
});
function TrafficPage() {
	const { brand } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<TrafficAnalysis
			key={brand}
			brandId={brand}
			search={search}
			onSearch={(patch, replace = false) => {
				return navigate({ search: (previous) => ({ ...previous, ...patch }), replace, resetScroll: false });
			}}
		/>
	);
}
