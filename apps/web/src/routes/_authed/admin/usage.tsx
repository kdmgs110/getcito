import { APP_LANGUAGE, UI_LOCALE, t } from "@/i18n";
/**
 * /admin/usage — Billable upstream API calls per provider and model.
 *
 * One row in provider_calls is one billable unit (one Olostep scrape, one chat
 * completion), so the numbers here are meant to be held directly against a
 * vendor's invoice rather than treated as an estimate.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@workspace/ui/components/chart";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { formatDateTime } from "@/lib/app-locale";
import { formatLatency } from "@/lib/format-duration";
import { getAppName } from "@/lib/route-head";
import { getProviderUsageFn } from "@/server/admin";

type Usage = Awaited<ReturnType<typeof getProviderUsageFn>>;

const RANGES = [7, 30, 90] as const;

/** Provider whose invoice this page exists to reconcile; pinned to the top. */
const PRIMARY_PROVIDER = "olostep";

export const Route = createFileRoute("/_authed/admin/usage")({
	head: ({ match }) => ({
		meta: [{ title: `${t("reports.apiUsage")} | ${getAppName(match)}` }],
	}),
	component: UsagePage,
});

function UsagePage() {
	const [days, setDays] = useState<number>(30);
	const [data, setData] = useState<Usage | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		getProviderUsageFn({ data: { days } })
			.then((result) => {
				if (!cancelled) {
					setData(result);
					setError(null);
				}
			})
			.catch((err: unknown) => {
				if (!cancelled)
					setError(APP_LANGUAGE === "en" && err instanceof Error ? err.message : t("reports.failedToLoadUsage"));
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [days]);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold">{t("reports.apiUsage")}</h1>
					<p className="text-muted-foreground">
						{t("reports.billableCallsToUpstreamProvidersOneRowPerScrapeOrCompletionStatus")}
					</p>
				</div>
				<div className="flex gap-2">
					{RANGES.map((range) => (
						<Button
							key={range}
							size="sm"
							variant={days === range ? "default" : "outline"}
							onClick={() => setDays(range)}
						>
							{t("reports.daysCount", { count: range })}
						</Button>
					))}
				</div>
			</div>

			{error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}

			{isLoading || !data ? (
				<div className="space-y-4">
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-72 w-full" />
				</div>
			) : (
				<UsageContent data={data} />
			)}
		</div>
	);
}

function UsageContent({ data }: { data: Usage }) {
	const primary = data.byProvider.find((p) => p.provider === PRIMARY_PROVIDER);
	const primaryModels = data.byModel.filter((m) => m.provider === PRIMARY_PROVIDER);
	const otherProviders = data.byProvider.filter((p) => p.provider !== PRIMARY_PROVIDER);

	// One line per provider, one point per day. Recharts wants a row per date
	// with a key per series, so the flat (date, provider, total) rows are pivoted.
	const providerIds = [...new Set(data.overTime.map((r) => r.provider))].filter((p) => p !== "none");
	const byDate = new Map<string, Record<string, number | string>>();
	for (const row of data.overTime) {
		const date = String(row.date).slice(0, 10);
		const entry = byDate.get(date) ?? { date };
		if (row.provider !== "none") entry[row.provider] = row.total;
		byDate.set(date, entry);
	}
	const series = [...byDate.values()].map((row) => {
		for (const id of providerIds) if (row[id] === undefined) row[id] = 0;
		return row;
	});

	const chartConfig = Object.fromEntries(
		providerIds.map((id, i) => [id, { label: id, color: `var(--chart-${(i % 5) + 1})` }]),
	);

	return (
		<>
			<div className="grid gap-4 sm:grid-cols-3">
				<StatCard
					title={t("reports.olostepCallsDays", { count: data.days })}
					value={primary?.total ?? 0}
					hint={
						primary?.failed
							? t("reports.failedBillable", { count: primary.failed })
							: t("reports.compareThisAgainstYourOlostepDashboard")
					}
				/>
				<StatCard
					title={t("reports.allProviders")}
					value={data.grandTotal}
					hint={t("reports.activeProviders", { count: data.byProvider.length })}
				/>
				<StatCard
					title={t("reports.trackedModels")}
					value={data.byModel.length}
					hint={t("reports.sinceDate", { date: formatDateTime(data.since, { dateStyle: "medium" }) })}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("reports.callsPerDay")}</CardTitle>
					<CardDescription>{t("reports.oneLinePerProvider")}</CardDescription>
				</CardHeader>
				<CardContent>
					{series.length === 0 || providerIds.length === 0 ? (
						<EmptyState />
					) : (
						<ChartContainer config={chartConfig} className="h-[260px] w-full">
							<LineChart data={series}>
								<CartesianGrid vertical={false} />
								<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
								<YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
								<ChartTooltip content={<ChartTooltipContent />} />
								{providerIds.map((id) => (
									<Line
										key={id}
										type="monotone"
										dataKey={id}
										stroke={`var(--color-${id})`}
										strokeWidth={2}
										dot={false}
									/>
								))}
							</LineChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("reports.olostepCallsByModel")}</CardTitle>
					<CardDescription>{t("reports.everyTrackedModelThatRoutesThroughOlostep")}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{primaryModels.length === 0 ? (
						<EmptyState />
					) : (
						<>
							<ChartContainer
								config={{ total: { label: t("reports.calls"), color: "var(--chart-1)" } }}
								className="h-[240px] w-full"
							>
								<BarChart data={primaryModels} layout="vertical" margin={{ left: 12 }}>
									<CartesianGrid horizontal={false} />
									<XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
									<YAxis type="category" dataKey="model" tickLine={false} axisLine={false} width={140} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Bar dataKey="total" fill="var(--color-total)" radius={4} />
								</BarChart>
							</ChartContainer>
							<UsageTable rows={primaryModels} total={primary?.total ?? 0} />
						</>
					)}
				</CardContent>
			</Card>

			{otherProviders.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>{t("reports.otherProviders")}</CardTitle>
						<CardDescription>{t("reports.directLlmApisAndAnyNonOlostepScrapers")}</CardDescription>
					</CardHeader>
					<CardContent>
						<UsageTable
							rows={data.byModel.filter((m) => m.provider !== PRIMARY_PROVIDER)}
							total={data.grandTotal - (primary?.total ?? 0)}
							showProvider
						/>
					</CardContent>
				</Card>
			)}

			{data.recentFailures.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>{t("reports.recentFailures")}</CardTitle>
						<CardDescription>{t("reports.countedInTheTotalsAboveACallThatErrorsUpstreamIsGenerally")}</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("reports.when")}</TableHead>
									<TableHead>{t("reports.provider")}</TableHead>
									<TableHead>{t("reports.model")}</TableHead>
									<TableHead>{t("reports.error")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.recentFailures.map((f) => (
									<TableRow key={f.id}>
										<TableCell className="whitespace-nowrap text-muted-foreground">
											{formatDateTime(f.createdAt)}
										</TableCell>
										<TableCell>{f.provider}</TableCell>
										<TableCell>{f.model}</TableCell>
										<TableCell className="max-w-md truncate text-xs" title={f.errorMessage ?? ""}>
											{f.errorMessage}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}
		</>
	);
}

function UsageTable({
	rows,
	total,
	showProvider = false,
}: {
	rows: Usage["byModel"];
	total: number;
	showProvider?: boolean;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					{showProvider && <TableHead>{t("reports.provider")}</TableHead>}
					<TableHead>{t("reports.model")}</TableHead>
					<TableHead className="text-right">{t("reports.calls")}</TableHead>
					<TableHead className="text-right">{t("reports.failed")}</TableHead>
					<TableHead className="text-right">{t("reports.share")}</TableHead>
					<TableHead className="text-right">{t("reports.avgTime")}</TableHead>
					<TableHead className="text-right">p95</TableHead>
					<TableHead className="text-right">{t("reports.slowest")}</TableHead>
					<TableHead className="text-right">{t("reports.lastCall")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={`${row.provider}:${row.model}`}>
						{showProvider && <TableCell className="text-muted-foreground">{row.provider}</TableCell>}
						<TableCell className="font-medium">{row.model}</TableCell>
						<TableCell className="text-right tabular-nums">{row.total.toLocaleString(UI_LOCALE)}</TableCell>
						<TableCell className="text-right tabular-nums">
							{row.failed > 0 ? <Badge variant="destructive">{row.failed}</Badge> : "—"}
						</TableCell>
						<TableCell className="text-right tabular-nums text-muted-foreground">
							{total > 0 ? `${Math.round((row.total / total) * 100)}%` : "—"}
						</TableCell>
						<TableCell className="text-right tabular-nums">{formatLatency(row.avgMs)}</TableCell>
						<TableCell className="text-right tabular-nums text-muted-foreground">{formatLatency(row.p95Ms)}</TableCell>
						<TableCell className="text-right tabular-nums text-muted-foreground">{formatLatency(row.maxMs)}</TableCell>
						<TableCell className="text-right text-muted-foreground whitespace-nowrap">
							{row.lastCallAt ? formatDateTime(row.lastCallAt) : "—"}
						</TableCell>
					</TableRow>
				))}
				<TableRow className="font-semibold">
					{showProvider && <TableCell />}
					<TableCell>{t("reports.total")}</TableCell>
					<TableCell className="text-right tabular-nums">{total.toLocaleString(UI_LOCALE)}</TableCell>
					<TableCell colSpan={6} />
				</TableRow>
			</TableBody>
		</Table>
	);
}

function StatCard({ title, value, hint }: { title: string; value: number; hint: string }) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardDescription>{title}</CardDescription>
				<CardTitle className="text-3xl tabular-nums">{value.toLocaleString(UI_LOCALE)}</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-xs text-muted-foreground">{hint}</p>
			</CardContent>
		</Card>
	);
}

function EmptyState() {
	return (
		<p className="text-sm text-muted-foreground py-8 text-center">
			{t("reports.noCallsRecordedYetForThisRangeTrackingStartsWithTheNext")}
		</p>
	);
}
