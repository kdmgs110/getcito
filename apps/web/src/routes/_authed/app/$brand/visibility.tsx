import { t } from "@/i18n";
/**
 * /app/$brand/visibility - Visibility charts page
 *
 * Shows prompts with visibility scores and trend charts.
 * Data is fetched client-side via TanStack Query hooks in PromptsDisplay,
 * so no route loader is needed (allows immediate rendering with skeletons).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { PromptsDisplay } from "@/components/prompts-display";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { coercePromptOrder, DEFAULT_PROMPT_ORDER, type PromptOrder } from "@/lib/prompt-order";

export const Route = createFileRoute("/_authed/app/$brand/visibility")({
	// The prompts list's sort order (#60) is this route's own search key, on top
	// of the brand-wide filter keys validated by the `$brand` layout route. The
	// default order is omitted so default state keeps a clean URL.
	validateSearch: (search: Record<string, unknown>): { order?: PromptOrder } => {
		const order = coercePromptOrder(search.order);
		return order === DEFAULT_PROMPT_ORDER ? {} : { order };
	},
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("dashboard.visibility"), { appName, brandName }) },
				{ name: "description", content: t("dashboard.visibilityDescription") },
			],
		};
	},
	component: VisibilityPage,
});

function VisibilityPage() {
	const { brand: brandId } = Route.useParams();

	const infoContent = (
		<>
			{t("dashboard.visibilityInfoPrefix")}
			<Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">
				{t("dashboard.competitorsInfoLink")}
			</Link>
			{t("dashboard.visibilityInfoSuffix")}
		</>
	);

	return (
		<PromptsDisplay
			pageTitle={t("dashboard.visibility")}
			pageDescription={t("dashboard.seeHowLlmsAreEvaluatingPromptsRelatedTo")}
			pageInfoContent={infoContent}
			editLink={`/app/${brandId}/settings/prompts`}
		/>
	);
}
