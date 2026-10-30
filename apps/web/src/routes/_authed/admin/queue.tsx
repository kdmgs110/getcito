import { APP_LANGUAGE, UI_LOCALE, t } from "@/i18n";
/**
 * /admin/queue - What the worker is running, what it picks up next, and how to
 * change that order.
 *
 * Distinct from /admin/workflows, which answers "is scheduling healthy": this
 * page answers "when will this particular brand actually run", which is a
 * question about queue position rather than about schedule adherence.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { ArrowUp, Clock, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandPriorityButton } from "@/components/brand-priority-button";
import { formatDuration, formatRelativeTime } from "@/lib/format-duration";
import { getAppName } from "@/lib/route-head";
import { getQueueOverviewFn } from "@/server/admin";

type QueueOverview = Awaited<ReturnType<typeof getQueueOverviewFn>>;

const REFRESH_MS = 15000;

function StatCard({
	title,
	value,
	hint,
	icon,
	tone,
}: {
	title: string;
	value: number;
	hint: string;
	icon: React.ReactNode;
	tone?: string;
}) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium flex items-center gap-2">
					{icon}
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<span className={`text-3xl font-bold ${tone ?? ""}`}>{value.toLocaleString(UI_LOCALE)}</span>
				<p className="text-xs text-muted-foreground mt-1">{hint}</p>
			</CardContent>
		</Card>
	);
}

function PriorityBadge({ priority }: { priority: number }) {
	if (priority <= 0) return <span className="text-xs text-muted-foreground">{t("reports.normal")}</span>;
	return (
		<Badge variant="secondary" className="bg-violet-100 text-violet-700">
			<ArrowUp className="h-3 w-3 mr-0.5" />
			{priority}
		</Badge>
	);
}

export const Route = createFileRoute("/_authed/admin/queue")({
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: `${t("reports.queue")} · ${appName}` },
				{ name: "description", content: t("reports.inspectAndReorderThePromptRunQueue") },
			],
		};
	},
	component: QueuePage,
});

function QueuePage() {
	const [data, setData] = useState<QueueOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [showAllBrands, setShowAllBrands] = useState(false);

	const fetchData = async (showRefreshing = false) => {
		if (showRefreshing) setIsRefreshing(true);
		try {
			setData(await getQueueOverviewFn());
			setError(null);
		} catch (err) {
			setError(APP_LANGUAGE === "en" && err instanceof Error ? err.message : t("reports.anErrorOccurred"));
		} finally {
			setLoading(false);
			setIsRefreshing(false);
		}
	};

	useEffect(() => {
		fetchData();
		const interval = setInterval(() => fetchData(), REFRESH_MS);
		return () => clearInterval(interval);
	}, []);

	if (loading) {
		return (
			<div className="space-y-8">
				<Skeleton className="h-10 w-64" />
				<div className="grid gap-4 md:grid-cols-4">
					{[0, 1, 2, 3].map((n) => (
						<Skeleton key={n} className="h-28" />
					))}
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (error && !data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-destructive">{t("reports.error")}</CardTitle>
				</CardHeader>
				<CardContent>
					<p>{error}</p>
				</CardContent>
			</Card>
		);
	}

	if (!data) return null;

	// Brands with nothing waiting are noise on a page about run order, so they are
	// collapsed behind a toggle rather than dropped - "why is this brand not in
	// the queue at all" is exactly the question this page gets asked.
	const brands = [...data.brands].sort(
		(a, b) =>
			(b.running > 0 ? 1 : 0) - (a.running > 0 ? 1 : 0) ||
			(a.bestPosition ?? Infinity) - (b.bestPosition ?? Infinity) ||
			b.readyNow - a.readyNow ||
			a.brandName.localeCompare(b.brandName),
	);
	const visibleBrands = showAllBrands ? brands : brands.filter((b) => b.running + b.readyNow > 0);
	const hiddenCount = brands.length - visibleBrands.length;

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<div className="space-y-2">
					<h1 className="text-3xl font-bold tracking-tight">{t("reports.queue")}</h1>
					<p className="text-muted-foreground">{t("reports.whatIsRunningNowWhatRunsNextAndWhichBrandJumpsThe")}</p>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{t("reports.updated")} {formatRelativeTime(data.generatedAt)}
					</span>
					<Button variant="outline" onClick={() => fetchData(true)} disabled={isRefreshing} className="cursor-pointer">
						<RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
						{t("reports.refresh")}
					</Button>
				</div>
			</div>

			{error && (
				<p className="text-sm text-red-600">
					{t("reports.lastRefreshFailed")} {error}
				</p>
			)}

			<div className="grid gap-4 md:grid-cols-4">
				<StatCard
					title={t("reports.running")}
					value={data.summary.running}
					hint={t("reports.inFlight")}
					icon={<PlayCircle className="h-4 w-4 text-emerald-500" />}
					tone="text-emerald-600"
				/>
				<StatCard
					title={t("reports.waitingNow")}
					value={data.summary.readyNow}
					hint={t("reports.brandsWaiting", { count: data.summary.brandsWaiting })}
					icon={<Clock className="h-4 w-4 text-blue-500" />}
					tone="text-blue-600"
				/>
				<StatCard
					title={t("reports.scheduledLater")}
					value={data.summary.scheduledLater}
					hint={t("reports.notYetDue")}
					icon={<Clock className="h-4 w-4" />}
				/>
				<StatCard
					title={t("reports.prioritised")}
					value={data.summary.prioritised}
					hint={t("reports.priorityHint", { priority: data.priorityValue })}
					icon={<ArrowUp className="h-4 w-4 text-violet-500" />}
					tone="text-violet-600"
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("reports.runningNow")}</CardTitle>
					<CardDescription>{t("reports.theWorkerTakesAFixedNumberOfPromptsAtATimeEverything")}</CardDescription>
				</CardHeader>
				<CardContent>
					{data.running.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t("reports.nothingRunning")}</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("reports.brand")}</TableHead>
									<TableHead>{t("reports.prompt")}</TableHead>
									<TableHead className="text-center">{t("reports.priority")}</TableHead>
									<TableHead className="text-center">{t("reports.runningFor")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.running.map((job) => (
									<TableRow key={job.jobId}>
										<TableCell className="font-medium">
											{job.brandId ? (
												<Link to="/app/$brand" params={{ brand: job.brandId }} className="text-primary hover:underline">
													{job.brandName}
												</Link>
											) : (
												job.brandName
											)}
										</TableCell>
										<TableCell className="max-w-md">
											<p className="truncate text-sm" title={job.promptValue}>
												{job.promptValue}
											</p>
										</TableCell>
										<TableCell className="text-center">
											<PriorityBadge priority={job.priority} />
										</TableCell>
										<TableCell className="text-center text-sm">
											<span className="inline-flex items-center gap-1">
												<Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
												{job.startedOn ? formatDuration(Date.now() - new Date(job.startedOn).getTime()) : "-"}
											</span>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("reports.byBrand")}</CardTitle>
					<CardDescription>{t("reports.runFirstMovesABrandSWaitingPromptsToTheFrontThe")}</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("reports.brand")}</TableHead>
								<TableHead className="text-center">{t("reports.nextUpAt")}</TableHead>
								<TableHead className="text-center">{t("reports.running")}</TableHead>
								<TableHead className="text-center">{t("reports.waiting")}</TableHead>
								<TableHead className="text-center">{t("reports.later")}</TableHead>
								<TableHead className="text-center">{t("reports.longestWait")}</TableHead>
								<TableHead className="text-center">{t("reports.lastRun")}</TableHead>
								<TableHead className="text-center">{t("reports.priority")}</TableHead>
								<TableHead className="text-center">{t("reports.actions")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visibleBrands.map((brand) => (
								<TableRow key={brand.brandId} className={brand.enabled ? "" : "opacity-50"}>
									<TableCell>
										<Link
											to="/app/$brand"
											params={{ brand: brand.brandId }}
											className="font-medium text-primary hover:underline"
										>
											{brand.brandName}
										</Link>
										<p className="text-xs text-muted-foreground">
											{brand.enabledPrompts} {t("reports.enabledPromptS")}
											{brand.enabled ? "" : t("reports.brandDisabled")}
										</p>
									</TableCell>
									<TableCell className="text-center text-sm">
										{brand.bestPosition ? `#${brand.bestPosition}` : <span className="text-muted-foreground">-</span>}
									</TableCell>
									<TableCell className="text-center text-sm">{brand.running || "-"}</TableCell>
									<TableCell className="text-center text-sm">{brand.readyNow || "-"}</TableCell>
									<TableCell className="text-center text-sm text-muted-foreground">
										{brand.scheduledLater || "-"}
									</TableCell>
									<TableCell className="text-center text-sm">
										{brand.oldestReadyWaitMs !== null ? formatDuration(brand.oldestReadyWaitMs) : "-"}
									</TableCell>
									<TableCell className="text-center text-sm">
										{brand.neverRun ? (
											<Badge variant="secondary" className="bg-amber-100 text-amber-700">
												{t("reports.neverRun")}
											</Badge>
										) : (
											formatRelativeTime(brand.lastRunAt)
										)}
									</TableCell>
									<TableCell className="text-center">
										<PriorityBadge priority={brand.maxPriority} />
									</TableCell>
									<TableCell className="text-center">
										<div className="flex justify-center">
											<BrandPriorityButton
												brandId={brand.brandId}
												isPrioritised={brand.maxPriority > 0}
												onUpdate={() => fetchData(true)}
											/>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{hiddenCount > 0 && (
						<Button variant="ghost" size="sm" className="mt-2 cursor-pointer" onClick={() => setShowAllBrands(true)}>
							{t("reports.show")} {hiddenCount} {t("reports.brandSWithNothingWaiting")}
						</Button>
					)}
					{showAllBrands && (
						<Button variant="ghost" size="sm" className="mt-2 cursor-pointer" onClick={() => setShowAllBrands(false)}>
							{t("reports.hideBrandsWithNothingWaiting")}
						</Button>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("reports.nextUp")}</CardTitle>
					<CardDescription>
						{t("reports.theOrderTheWorkerWillPullTheseInHighestPriorityFirstThen")} {data.upNext.length}{" "}
						{t("reports.of")} {data.summary.readyNow}.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{data.upNext.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t("reports.nothingWaitingTheQueueIsDrained")}</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-16 text-center">#</TableHead>
									<TableHead>{t("reports.brand")}</TableHead>
									<TableHead>{t("reports.prompt")}</TableHead>
									<TableHead className="text-center">{t("reports.priority")}</TableHead>
									<TableHead className="text-center">{t("reports.waiting")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.upNext.map((job) => (
									<TableRow key={job.jobId} className={job.priority > 0 ? "bg-violet-50/50" : ""}>
										<TableCell className="text-center text-sm text-muted-foreground">{job.position}</TableCell>
										<TableCell className="font-medium">
											{job.brandId ? (
												<Link to="/app/$brand" params={{ brand: job.brandId }} className="text-primary hover:underline">
													{job.brandName}
												</Link>
											) : (
												job.brandName
											)}
										</TableCell>
										<TableCell className="max-w-md">
											<p className="truncate text-sm" title={job.promptValue}>
												{job.promptValue}
											</p>
										</TableCell>
										<TableCell className="text-center">
											<PriorityBadge priority={job.priority} />
										</TableCell>
										<TableCell className="text-center text-sm">
											{job.createdOn ? formatDuration(Date.now() - new Date(job.createdOn).getTime()) : "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
