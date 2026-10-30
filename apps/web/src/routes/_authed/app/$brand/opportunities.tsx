import { t } from "@/i18n";
/**
 * /app/$brand/opportunities — AI-generated opportunities.
 *
 * The page renders a structured opportunities report. We assemble a deterministic
 * digest of the brand's tracked citation data (per-query standing vs the leading
 * competitor over 7d + 30d, citation difficulty, where answers are sourced, and
 * per-platform visibility) and make a single structured LLM completion (no web
 * search) to turn it into categorized opportunities. The report is cached
 * server-side and regenerated only when stale — see server/opportunities.ts.
 */

import { IconLoader2 } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { OpportunitiesReport } from "@/components/opportunities-report";
import { PageHeader } from "@/components/page-header";
import { useOpportunities } from "@/hooks/use-opportunities";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";

export const Route = createFileRoute("/_authed/app/$brand/opportunities")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("dashboard.opportunities"), { appName, brandName }) },
				{ name: "description", content: t("dashboard.opportunitiesDescription") },
			],
		};
	},
	component: OpportunitiesPage,
});

function OpportunitiesPage() {
	const { brand: brandId } = Route.useParams();
	const { data, isLoading, isError } = useOpportunities(brandId);

	const infoContent = t("dashboard.recommendationsRefresh");

	let content: React.ReactNode;
	if (isLoading) {
		content = <LoadingState />;
	} else if (isError) {
		content = <EmptyCard>{t("dashboard.couldnTGenerateRecommendationsRightNowReloadThe")}</EmptyCard>;
	} else if (!data || data.reason === "insufficient-data" || !data.report) {
		content = <EmptyCard>{t("dashboard.weNeedABitMoreTrackingDataBefore")}</EmptyCard>;
	} else {
		content = <OpportunitiesReport report={data.report} brandId={brandId} />;
	}

	return (
		<PageHeader
			title={t("dashboard.opportunities")}
			subtitle={t("dashboard.whatToCreatePitchAndSeedToEarn")}
			infoContent={infoContent}
		>
			<div className="space-y-6">{content}</div>
		</PageHeader>
	);
}

function EmptyCard({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-border">
			<p className="px-6 py-10 text-center text-sm text-muted-foreground">{children}</p>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<IconLoader2 className="size-4 animate-spin" />
				{t("dashboard.analyzingYourCitationLandscapeAndDraftingYourOpportunities")}
			</div>
			<div className="space-y-2">
				<Skeleton className="h-6 w-2/3" />
				<Skeleton className="h-4 w-full max-w-[70ch]" />
				<Skeleton className="h-4 w-1/2" />
			</div>
			<div className="space-y-3">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-28 w-full rounded-xl" />
				))}
			</div>
		</div>
	);
}
