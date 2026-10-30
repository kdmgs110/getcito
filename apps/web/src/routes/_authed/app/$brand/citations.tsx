import { t } from "@/i18n";
/**
 * /app/$brand/citations - Citations tracking page
 *
 * Shows citation statistics with filtering by model, tags, and lookback period.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useCitations } from "@/hooks/use-citations";
import { useBrand, brandKeys } from "@/hooks/use-brands";
import { useListFilters } from "@/hooks/use-list-filters";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { CitationsDisplay } from "@/components/citations-display";
import { FilteredListShell } from "@/components/filtered-list-shell";
import { getDaysFromLookback, parseCustomLookback } from "@/lib/chart-utils";
import { PageHeader } from "@/components/page-header";
import { getAvailableModels, ALL_MODELS_VALUE } from "@/components/filter-bar";

export const Route = createFileRoute("/_authed/app/$brand/citations")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("dashboard.citations"), { appName, brandName }) },
				{ name: "description", content: t("dashboard.seeWhichSourcesLlmsCiteInResponsesTo") },
			],
		};
	},
	component: CitationsPage,
});

function CitationsPage() {
	const { brand: brandId } = Route.useParams();
	const queryClient = useQueryClient();

	const filters = useListFilters();
	const days = getDaysFromLookback(filters.lookback);
	// A custom range ends on its own last day rather than today.
	const endDate = parseCustomLookback(filters.lookback)?.to;

	const { brand } = useBrand(brandId);
	const availableModels = getAvailableModels(brand?.effectiveModels ?? []);

	// Get citation data with tag and model filter
	const modelParam = filters.model === ALL_MODELS_VALUE ? undefined : filters.model;
	const {
		citations: citationData,
		isLoading,
		isError,
		revalidate: revalidateCitations,
	} = useCitations(brandId, {
		days,
		endDate,
		tags: filters.tags.length > 0 ? filters.tags : undefined,
		model: modelParam,
	});

	const infoContent = (
		<>
			<p className="mb-2">{t("dashboard.citationsAreTheLinksAndSourcesThatAi")}</p>
			<p>
				{t("dashboard.competitorDomainsPrefix")}
				<Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">
					{t("dashboard.trackedCompetitorsList")}
				</Link>
				{t("dashboard.competitorDomainsSuffix")}
			</p>
		</>
	);

	const showFullSkeleton = isLoading && !citationData;

	return (
		<PageHeader
			title={t("dashboard.citations")}
			subtitle={t("dashboard.seeWhichSourcesLlmsCiteWhenRespondingTo")}
			infoContent={infoContent}
		>
			<FilteredListShell
				filters={filters}
				availableTags={citationData?.availableTags || []}
				availableModels={availableModels}
				showModelSelector
				isLoading={showFullSkeleton}
				loadingState={
					<Card>
						<CardHeader>
							<Skeleton className="h-6 w-48" />
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-4 w-1/2" />
								<Skeleton className="h-4 w-2/3" />
							</div>
						</CardContent>
					</Card>
				}
				isError={Boolean(isError) || !citationData}
				errorState={
					<Card>
						<CardContent className="pt-6">
							<div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
								{t("dashboard.failedToLoadCitationDataPleaseTryAgain")}
							</div>
						</CardContent>
					</Card>
				}
				totalCount={citationData?.totalCitations}
				noMatchesTitle={t("dashboard.noMatchingCitations")}
				noMatchesDescription={t("dashboard.adjustFiltersHelp")}
				emptyState={
					<Card>
						<CardContent className="pt-6">
							<div className="text-muted-foreground text-center py-8">
								{t("dashboard.noCitationsFoundCitationsAreOnlyAvailableFrom")}
							</div>
						</CardContent>
					</Card>
				}
			>
				{citationData && (
					<CitationsDisplay
						citationData={citationData}
						brandId={brandId}
						brandName={brand?.name}
						showStats={true}
						maxDomains={10}
						maxUrls={20}
						days={days}
						onCompetitorAdded={() => {
							revalidateCitations();
							queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
							queryClient.invalidateQueries({ queryKey: brandKeys.competitors(brandId) });
							queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
						}}
					/>
				)}
			</FilteredListShell>
		</PageHeader>
	);
}
