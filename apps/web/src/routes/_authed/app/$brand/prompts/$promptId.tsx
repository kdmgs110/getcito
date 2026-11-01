import { IconInfoCircle } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { measurementTargetLabel } from "@workspace/lib/measurement";
import { extractTextContent } from "@workspace/lib/text-extraction";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
/**
 * /app/$brand/prompts/$promptId - Prompt detail page
 *
 * Shows prompt details with tabs: Mentions, Web Queries, Citations, LLM Responses.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { type CitationData, CitationsDisplay } from "@/components/citations-display";
import {
	InfoTip,
	QueryWordsSection,
	UnknownQueriesNote,
	type VariationModelCount,
	VariationsList,
} from "@/components/fanout-sections";
import { ListPagination } from "@/components/list-pagination";
import { LookbackSelector, useLookbackPeriod } from "@/components/lookback-selector";
import { ProgressBarChart } from "@/components/progress-bar-chart";
import { PromptLanguageFilter } from "@/components/prompt-language-filter";
import { PromptMeasurementComparison, PromptMeasurementEvidencePanel } from "@/components/prompt-measurements";
import { PromptRunContext } from "@/components/prompt-run-context";
import { WebLogo } from "@/components/web-logo";
import { useBrand, useCompetitors } from "@/hooks/use-brands";
import { usePromptRunsOnly } from "@/hooks/use-prompt-runs-only";
import { usePromptStats } from "@/hooks/use-prompt-stats";
import { useQueryFanout } from "@/hooks/use-query-fanout";
import { createTranslator, formatNumber, t } from "@/i18n";
import { formatDateTime } from "@/lib/app-locale";
import { getDaysFromLookback, parseCustomLookback } from "@/lib/chart-utils";
import { promptKeywords } from "@/lib/fanout-analysis";
import type { PromptMeasurementRecord } from "@/lib/prompt-measurements";
import { isPromptRunLanguageFilter } from "@/lib/prompt-run-language";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { shareOfVoiceColorMap } from "@/lib/share-of-voice-palette";
import { getModelDisplayName } from "@/lib/utils";
import { getPromptMetadataFn } from "@/server/prompts";

const measurementViewText = createTranslator({
	history: { ja: "実行履歴", en: "Run history" },
	compare: { ja: "回答比較", en: "Compare answers" },
	unknownProvider: { ja: "取得元未記録", en: "Provider not recorded" },
});
const measurementId = (value: unknown): string | undefined =>
	typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
		? value
		: undefined;

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

type PromptMetadata = {
	id: string;
	brandId: string;
	value: string;
	enabled: boolean;
	tags: string[];
	systemTags: string[];
	nextRunAt?: string | null;
};

const TAB_KEYS = ["mentions", "web-queries", "citations", "responses"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: { key: TabKey; label: string }[] = [
	{ key: "mentions", label: t("dashboard.mentions") },
	{ key: "web-queries", label: t("dashboard.webQueries") },
	{ key: "citations", label: t("dashboard.citations") },
	{ key: "responses", label: t("dashboard.llmResponses") },
];

export const Route = createFileRoute("/_authed/app/$brand/prompts/$promptId")({
	// `tab` is part of the route's search schema so links can target a specific
	// tab (e.g. View Details → web-queries). Absent means the default tab.
	validateSearch: (
		search: Record<string, unknown>,
	): {
		tab?: TabKey;
		language?: string;
		view?: "compare";
		attemptId?: string;
		runId?: string;
		targetKey?: string;
	} => ({
		tab: TAB_KEYS.includes(search.tab as TabKey) ? (search.tab as TabKey) : undefined,
		language: isPromptRunLanguageFilter(search.language) ? search.language : undefined,
		view: search.view === "compare" ? "compare" : undefined,
		attemptId: measurementId(search.attemptId),
		runId: measurementId(search.runId),
		targetKey: typeof search.targetKey === "string" && search.targetKey.length <= 500 ? search.targetKey : undefined,
	}),
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("dashboard.promptDetails"), { appName, brandName }) },
				{ name: "description", content: t("dashboard.detailedAnalysisOfATrackedPromptSPerformance") },
			],
		};
	},
	component: PromptHistoryPage,
});

function PromptHistoryPage() {
	const { brand: brandId, promptId } = Route.useParams();

	const lookback = useLookbackPeriod();
	const days = getDaysFromLookback(lookback);
	// A custom range ends on its own last day rather than today.
	const endDate = parseCustomLookback(lookback)?.to;

	const activeTab = Route.useSearch({ select: (s) => s.tab ?? "mentions" });
	const navigate = Route.useNavigate();
	const historyModel = Route.useSearch({ select: (search) => search.model === "all" ? undefined : search.model });
	const language = Route.useSearch({ select: (search) => search.language ?? "all" });
	const measurementSelection = Route.useSearch({
		select: (search) => ({ attemptId: search.attemptId, runId: search.runId, targetKey: search.targetKey }),
	});
	const comparisonView = Route.useSearch({ select: (search) => search.view === "compare" });
	const measurementScope = { brandId, promptId, lookback, language };
	const showMeasurementQueries = useCallback(
		(record: PromptMeasurementRecord) => {
			setVisitedTabs((previous) => new Set([...previous, "web-queries"]));
			navigate({
				search: (previous) => ({
					...previous,
					tab: "web-queries",
					attemptId: record.attemptId ?? undefined,
					runId: record.runId ?? undefined,
					targetKey: record.targetKey,
				}),
				replace: true,
				resetScroll: false,
			});
		},
		[navigate],
	);
	const setActiveTab = useCallback(
		(tab: TabKey) =>
			navigate({
				search: (prev) => ({ ...prev, tab: tab === "mentions" ? undefined : tab }),
				replace: true,
				resetScroll: false,
			}),
		[navigate],
	);
	const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set([activeTab]));
	const [currentPage, setCurrentPage] = useState(1);
	const [promptMeta, setPromptMeta] = useState<PromptMetadata | null>(null);
	const [isMetaLoading, setIsMetaLoading] = useState(true);

	const { brand } = useBrand(brandId);

	// Web Queries fetches its own data (useQueryFanout) — stats only back Mentions/Citations.
	const shouldFetchStats = visitedTabs.has("mentions") || visitedTabs.has("citations");
	const {
		isLoading: isStatsLoading,
		isError: isStatsError,
		aggregations,
	} = usePromptStats(shouldFetchStats ? promptId : "", { days, endDate, language });

	const shouldFetchRuns = visitedTabs.has("responses") && !comparisonView;
	const {
		runs,
		pagination,
		isLoading: isRunsLoading,
		isError: isRunsError,
	} = usePromptRunsOnly(shouldFetchRuns ? promptId : "", {
		model: historyModel,
		page: currentPage,
		limit: 15,
		days,
		endDate,
		language,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: A language or target change must reset the history pagination.
	useEffect(() => {
		setCurrentPage(1);
	}, [language, historyModel]);

	// Fetch prompt metadata
	useEffect(() => {
		if (!brandId || !promptId) return;
		setIsMetaLoading(true);
		getPromptMetadataFn({ data: { brandId, promptId } })
			.then((data) => {
				if (data) {
					setPromptMeta(data);
				}
			})
			.catch(console.error)
			.finally(() => setIsMetaLoading(false));
	}, [brandId, promptId]);

	const handleTabChange = useCallback(
		(tab: TabKey) => {
			setActiveTab(tab);
			setVisitedTabs((prev) => {
				if (prev.has(tab)) return prev;
				return new Set([...prev, tab]);
			});
		},
		[setActiveTab],
	);

	const handleLookbackChange = useCallback(() => {
		setCurrentPage(1);
	}, []);

	const handlePageChange = (newPage: number) => {
		if (newPage >= 1 && newPage <= (pagination?.totalPages || 1)) {
			setCurrentPage(newPage);
		}
	};

	const mentionStats = aggregations?.mentionStats || [];
	const citationStats = aggregations?.citationStats;

	const systemTags = promptMeta?.systemTags || [];
	const userTags = promptMeta?.tags || [];
	const hasTags = systemTags.length > 0 || userTags.length > 0;

	if (
		((activeTab === "mentions" || activeTab === "citations") && isStatsError) ||
		(activeTab === "responses" && !comparisonView && isRunsError)
	) {
		return (
			<div className="space-y-6">
				<div className="flex justify-between items-start">
					<h1 className="text-3xl font-bold">{t("dashboard.promptDetails")}</h1>
					<LookbackSelector onLookbackChange={handleLookbackChange} />
				</div>
				<Card>
					<CardContent className="pt-6">
						<div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
							{t("dashboard.failedToLoadPromptDataPleaseTryAgain")}
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!isMetaLoading && !promptMeta) {
		return (
			<div className="space-y-6">
				<h1 className="text-3xl font-bold">{t("dashboard.promptDetails")}</h1>
				<Card>
					<CardContent className="pt-6">
						<div className="text-muted-foreground">{t("dashboard.noPromptDataFound")}</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="space-y-0">
			{/* HEADER */}
			<div className="pb-6 space-y-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="flex-1 min-w-0">
						{isMetaLoading ? (
							<Skeleton className="h-8 w-[28rem] max-w-full" />
						) : (
							<h1 className="text-2xl font-semibold tracking-tight leading-tight break-words">{promptMeta?.value}</h1>
						)}
					</div>
					<div className="shrink-0">
						<LookbackSelector onLookbackChange={handleLookbackChange} />
					</div>
				</div>

				{isMetaLoading ? (
					<div className="flex items-center gap-3">
						<Skeleton className="h-5 w-14" />
						<Skeleton className="h-5 w-40" />
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
						{promptMeta?.enabled ? (
							<span className="inline-flex items-center gap-1.5 text-green-700">
								<span className="relative flex h-2 w-2">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
									<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
								</span>
								{t("dashboard.active")}
							</span>
						) : (
							<span className="text-muted-foreground">{t("dashboard.disabled")}</span>
						)}

						{promptMeta?.nextRunAt && (
							<>
								<span className="text-border">|</span>
								<span className="text-muted-foreground">
									{t("dashboard.nextRun")}
									<span className="text-foreground tabular-nums">
										{formatDateTime(promptMeta.nextRunAt, {
											month: "short",
											day: "numeric",
											hour: "numeric",
											minute: "2-digit",
										})}
									</span>
								</span>
							</>
						)}

						{hasTags && <span className="text-border">|</span>}

						{hasTags && (
							<div className="flex items-center gap-1.5">
								<span className="text-muted-foreground">{t("dashboard.tags")}</span>
								{systemTags.map((tag) => (
									<Badge key={`sys-${tag}`} variant="secondary" className="text-xs capitalize font-normal">
										{tag}
									</Badge>
								))}
								{userTags.map((tag) => (
									<Badge key={`usr-${tag}`} variant="outline" className="text-xs capitalize font-normal">
										{tag}
									</Badge>
								))}
							</div>
						)}

						<span className="text-border">|</span>

						<Link
							to="/app/$brand/settings/prompts"
							params={{ brand: brandId }}
							className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 decoration-muted-foreground/40 hover:decoration-foreground/40"
						>
							{t("dashboard.editPrompts")}
						</Link>
					</div>
				)}
			</div>

			<PromptLanguageFilter
				language={language}
				onChange={(value) => {
					setCurrentPage(1);
					navigate({
						search: (previous) => ({ ...previous, language: value === "all" ? undefined : value }),
						replace: true,
						resetScroll: false,
					});
				}}
			/>

			{/* TABS */}
			<div className="border-b border-border">
				<div className="flex items-end justify-between">
					<nav className="-mb-px flex gap-6" aria-label={t("dashboard.tabs")}>
						{TABS.map(({ key, label }) => (
							<button
								key={key}
								type="button"
								onClick={() => handleTabChange(key)}
								className={`cursor-pointer whitespace-nowrap pb-3 text-sm font-medium transition-colors border-b-2 ${
									activeTab === key
										? "border-foreground text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
								}`}
							>
								{label}
							</button>
						))}
					</nav>
					{aggregations?.totalRuns != null && (
						<span className="pb-3 text-xs text-muted-foreground tabular-nums">
							{t("dashboard.runsInPeriod", { count: formatNumber(aggregations.totalRuns) })}
						</span>
					)}
				</div>
			</div>

			{/* TAB CONTENT */}
			<div className="pt-6 space-y-6">
				{activeTab === "mentions" && (
					<MentionsTab
						isLoading={isStatsLoading}
						mentionStats={mentionStats}
						totalRuns={aggregations?.totalRuns || 0}
						brandName={brand?.name}
						brandId={brandId}
					/>
				)}

				{activeTab === "web-queries" &&
					(measurementSelection.attemptId || measurementSelection.runId ? (
						<PromptMeasurementEvidencePanel
							scope={measurementScope}
							selection={measurementSelection}
							onClear={() =>
								navigate({
									search: (previous) => ({ ...previous, attemptId: undefined, runId: undefined, targetKey: undefined }),
									replace: true,
									resetScroll: false,
								})
							}
						/>
					) : (
						<WebQueriesTab
							brandId={brandId}
							promptId={promptId}
							promptValue={promptMeta?.value ?? ""}
							lookback={lookback}
							language={language}
						/>
					))}

				{activeTab === "citations" && (
					<CitationsTab
						isLoading={isStatsLoading}
						citationStats={citationStats}
						brandId={brandId}
						brandName={brand?.name}
					/>
				)}

				{activeTab === "responses" && (
					<div className="space-y-4">
						<fieldset
							className="inline-flex gap-1 rounded-md border bg-muted/30 p-1"
							aria-label={t("dashboard.llmResponses")}
						>
							{([false, true] as const).map((compare) => (
								<button
									key={String(compare)}
									type="button"
									aria-pressed={comparisonView === compare}
									className={`rounded px-3 py-1.5 text-sm ${comparisonView === compare ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
									onClick={() =>
										navigate({
											search: (previous) => ({ ...previous, view: compare ? "compare" : undefined }),
											replace: true,
											resetScroll: false,
										})
									}
								>
									{measurementViewText(compare ? "compare" : "history")}
								</button>
							))}
						</fieldset>
						{comparisonView ? (
							<PromptMeasurementComparison
								key={`${brandId}:${promptId}`}
								scope={measurementScope}
								preferredTargetKey={measurementSelection.targetKey ?? historyModel}
								onQueries={showMeasurementQueries}
							/>
						) : (
							<ResponsesTab
								runs={runs}
								pagination={pagination}
								isLoading={isRunsLoading}
								currentPage={currentPage}
								onPageChange={handlePageChange}
								brandName={brand?.name}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

// =====================================================================
// Tab Content Components
// =====================================================================

function TabLoadingSkeleton({ lines = 3 }: { lines?: number }) {
	return (
		<Card>
			<CardHeader>
				<Skeleton className="h-5 w-32 mb-2" />
				<Skeleton className="h-4 w-80" />
			</CardHeader>
			<Separator />
			<CardContent className="space-y-4 pt-6">
				{Array.from({ length: lines }, (_, index) => `line-${index}`).map((key) => (
					<Skeleton key={key} className="h-8 w-full" />
				))}
			</CardContent>
		</Card>
	);
}

function MentionsTab({
	isLoading,
	mentionStats,
	totalRuns,
	brandName,
	brandId,
}: {
	isLoading: boolean;
	mentionStats: { name: string; count: number }[];
	totalRuns: number;
	brandName?: string;
	brandId: string;
}) {
	const { brand } = useBrand(brandId);
	const { competitors } = useCompetitors(brandId);

	if (isLoading) return <TabLoadingSkeleton lines={5} />;

	if (mentionStats.length === 0) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				{t("dashboard.noMentionDataAvailableForThisTimePeriod")}
			</div>
		);
	}

	const brandMentionPct = Math.round(
		((mentionStats.find((s) => s.name === brandName)?.count || 0) / (totalRuns || 1)) * 100,
	);

	const colorMap = shareOfVoiceColorMap(
		mentionStats.map((s) => ({
			name: s.name,
			isBrand: s.name === brandName,
			mentions: s.count,
		})),
	);

	const getDomain = (name: string) => {
		if (name === brand?.name) return brand?.website;
		return competitors?.find((c) => c.name === name)?.domains?.[0];
	};

	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-base">
					{t("dashboard.mentions")}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">
							<p>
								{t("dashboard.trackedCompetitorsPrefix")}
								<Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">
									{t("dashboard.trackedCompetitorsList")}
								</Link>{" "}
								{t("dashboard.trackedCompetitorsSuffix")}
							</p>
							<p className="mt-2">{t("dashboard.missingCompetitorHelp")}</p>
						</TooltipContent>
					</Tooltip>
				</CardTitle>
				<CardDescription>
					{t("dashboard.brandMentionSummary", {
						brand: brandName ?? "",
						percentage: brandMentionPct,
						runs: formatNumber(totalRuns),
					})}
				</CardDescription>
			</CardHeader>
			<Separator />
			<CardContent>
				<ProgressBarChart
					showColorIndicator
					items={mentionStats.map((stat) => {
						const domain = getDomain(stat.name);
						return {
							label: stat.name,
							count: stat.count,
							color: colorMap.get(stat.name) || "#3b82f6",
							icon: domain ? <WebLogo domain={domain} size={16} /> : undefined,
						};
					})}
					customTotal={totalRuns || 1}
					highlightLabel={brandName}
				/>
			</CardContent>
		</Card>
	);
}

function WebQueriesTab({
	brandId,
	promptId,
	promptValue,
	lookback,
	language,
}: {
	brandId: string;
	promptId: string;
	promptValue: string;
	lookback: ReturnType<typeof useLookbackPeriod>;
	language: string;
}) {
	// Same pipeline as the Query Fan-Out page, scoped to this prompt — echo and
	// "unavailable" sentinels filtered, and (unlike the brand-wide page) every
	// variation returned.
	const { data, isLoading, isError } = useQueryFanout(brandId, { lookback, promptId, language });

	// query → per-model counts, for the inline "2× ChatGPT" breakdown. byModel
	// lists are uncapped in single-prompt mode, so every variation resolves.
	const modelCounts = useMemo(() => {
		const map = new Map<string, VariationModelCount[]>();
		for (const m of data?.byModel ?? []) {
			for (const q of m.topQueries) {
				const entry = map.get(q.query);
				if (entry) entry.push({ model: m.model, count: q.count });
				else map.set(q.query, [{ model: m.model, count: q.count }]);
			}
		}
		for (const counts of map.values()) counts.sort((a, b) => b.count - a.count);
		return map;
	}, [data]);

	if (isLoading && !data) return <TabLoadingSkeleton lines={6} />;
	if (isError && !data) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				{t("dashboard.couldnTLoadWebQueriesRightNowReload")}
			</div>
		);
	}
	if (!data || data.totalQueries === 0) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				{t("dashboard.noWebQueryDataAvailableForThisTime")}
			</div>
		);
	}

	return (
		<Tabs defaultValue="fanout" className="gap-4">
			<TabsList>
				<TabsTrigger value="fanout">{t("dashboard.promptFanOut")}</TabsTrigger>
				<TabsTrigger value="words">{t("dashboard.queryWords")}</TabsTrigger>
			</TabsList>
			<TabsContent value="fanout">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-1.5 text-base">
							{t("dashboard.promptFanOut")}
							<InfoTip>{t("dashboard.everyDistinctSearchEnginesRanWhileAnsweringThis")}</InfoTip>
						</CardTitle>
						<CardDescription>
							{t("dashboard.distinctSearches", { count: formatNumber(data.uniqueQueries) })}
						</CardDescription>
					</CardHeader>
					<Separator />
					<CardContent>
						<div className="mb-3 space-y-1 empty:hidden">
							<UnknownQueriesNote byModel={data.byModel} />
						</div>
						<VariationsList
							variations={data.topQueries}
							keywords={promptKeywords(promptValue)}
							totalUnique={data.uniqueQueries}
							modelCounts={modelCounts}
						/>
					</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="words">
				<QueryWordsSection terms={data.terms} wordChanges={data.wordChanges} />
			</TabsContent>
		</Tabs>
	);
}

function CitationsTab({
	isLoading,
	citationStats,
	brandId,
	brandName,
}: {
	isLoading: boolean;
	citationStats: CitationData | undefined;
	brandId: string;
	brandName?: string;
}) {
	if (isLoading) return <TabLoadingSkeleton lines={6} />;

	if (!citationStats || citationStats.totalCitations === 0) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				{t("dashboard.noCitationDataAvailableForThisTimePeriod")}
			</div>
		);
	}

	return (
		<CitationsDisplay
			citationData={citationStats}
			brandId={brandId}
			brandName={brandName}
			showStats={true}
			maxDomains={10}
			maxUrls={50}
		/>
	);
}

function ResponsesTab({
	runs,
	pagination,
	isLoading,
	currentPage,
	onPageChange,
	brandName,
}: {
	runs: ReturnType<typeof usePromptRunsOnly>["runs"];
	pagination: ReturnType<typeof usePromptRunsOnly>["pagination"];
	isLoading: boolean;
	currentPage: number;
	onPageChange: (page: number) => void;
	brandName?: string;
}) {
	const formatDate = (dateString: string | Date) => formatDateTime(dateString, { timeZoneName: "short" });

	const formatRawOutput = (rawOutput: unknown) =>
		typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput, null, 2);

	if (isLoading && runs.length === 0) {
		return (
			<div className="space-y-4">
				{["first", "second", "third"].map((key) => (
					<Card key={key}>
						<CardHeader className="pb-0 gap-y-0">
							<div className="grid grid-cols-3 gap-x-4">
								<div>
									<Skeleton className="h-4 w-20 mb-1" />
									<Skeleton className="h-4 w-16" />
								</div>
								<div>
									<Skeleton className="h-4 w-16 mb-1" />
									<Skeleton className="h-4 w-24" />
								</div>
								<div>
									<Skeleton className="h-4 w-20 mb-1" />
									<Skeleton className="h-4 w-32" />
								</div>
							</div>
						</CardHeader>
						<Separator />
						<CardContent className="space-y-4">
							<Skeleton className="h-20 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (runs.length === 0) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				{t("dashboard.noPromptRunsFoundForThisTimePeriod")}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<h3 className="text-base font-medium">{t("dashboard.individualPromptRuns")}</h3>

			{runs.map((run) => (
				<Card key={run.id}>
					<CardHeader className="pb-0 gap-y-0">
						<div className="grid grid-cols-3 gap-x-4 text-sm">
							<div>
								<span className="text-muted-foreground block text-xs mb-0.5">{t("dashboard.model")}</span>
								<span>
									{["chatgpt", "google-ai-overview", "google-ai-mode"].includes(run.model)
										? measurementTargetLabel(run.model, run.provider)
										: getModelDisplayName(run.model)}
								</span>
								<span className="block text-xs text-muted-foreground">
									{run.provider ?? measurementViewText("unknownProvider")}
								</span>
							</div>
							<div>
								<span className="text-muted-foreground block text-xs mb-0.5">{t("dashboard.version")}</span>
								<span>{run.version}</span>
							</div>
							<div>
								<span className="text-muted-foreground block text-xs mb-0.5">{t("dashboard.evaluated")}</span>
								<span>{formatDate(run.createdAt)}</span>
							</div>
						</div>
					</CardHeader>
					<Separator />
					<CardContent className="space-y-5">
						<PromptRunContext
							context={run.requestContext}
							responseText={extractTextContent(run.rawOutput, run.provider ?? run.model)}
						/>
						{run.webQueries && run.webQueries.length > 0 && (
							<div>
								<span className="text-xs text-muted-foreground block mb-1.5">{t("dashboard.webQueries")}</span>
								<div className="flex flex-wrap gap-1.5">
									{[...new Set(run.webQueries)].map((query) => (
										<Badge key={query} variant="outline" className="text-xs font-normal">
											{query}
										</Badge>
									))}
								</div>
							</div>
						)}

						<div>
							<span className="text-xs text-muted-foreground block mb-1.5">{t("dashboard.brandsMentioned")}</span>
							<div className="flex flex-wrap gap-1.5">
								{run.brandMentioned && brandName && <Badge className="text-xs font-normal">{brandName}</Badge>}
								{[...new Set(run.competitorsMentioned ?? [])].map((competitor) => (
									<Badge key={competitor} variant="outline" className="text-xs font-normal">
										{competitor}
									</Badge>
								))}
								{!run.brandMentioned && (!run.competitorsMentioned || run.competitorsMentioned.length === 0) && (
									<span className="text-xs text-muted-foreground">{t("dashboard.none")}</span>
								)}
							</div>
						</div>

						<div>
							<span className="text-xs text-muted-foreground block mb-1.5">{t("dashboard.llmResponse")}</span>
							<div className="rounded-md border bg-muted/30 p-4 max-h-64 overflow-auto prose prose-sm max-w-none">
								<ReactMarkdown>{extractTextContent(run.rawOutput, run.provider ?? run.model)}</ReactMarkdown>
							</div>
						</div>

						<div>
							<span className="text-xs text-muted-foreground block mb-1.5">{t("dashboard.rawOutput")}</span>
							<div className="rounded-md border bg-muted/20 p-4 max-h-64 overflow-auto">
								<pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap">
									{formatRawOutput(run.rawOutput)}
								</pre>
							</div>
						</div>
					</CardContent>
				</Card>
			))}

			<ListPagination
				page={currentPage - 1}
				pageSize={pagination?.limit ?? 15}
				totalItems={pagination?.total ?? runs.length}
				onPageChange={(p) => onPageChange(p + 1)}
			/>
		</div>
	);
}
