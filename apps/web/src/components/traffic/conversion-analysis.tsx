import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AI_PROVIDERS,
	type ConversionGoal,
	type ConversionMetrics,
	type ConversionPeriod,
	type ConversionReport,
	type TrafficConnectionStatus,
	type TrafficRequest,
} from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { useId, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber, t, UI_LOCALE } from "@/i18n";
import { getConversionReportFn, listConversionGoalsFn } from "@/server/conversions";
import { ConversionSettings } from "./conversion-settings";
import {
	conversionGoalRevisionKey,
	conversionNumber,
	conversionRate,
	resolveConversionSelection,
} from "./conversion-state";
import { QualityNotices } from "./quality-notices";
import { TrafficCard, TrafficError, TrafficLoading } from "./shared";
import { dateLabel, GrainToggle, sourceColors, sourceLabels } from "./traffic-chart";
import { scopeChange, type TrafficSearch, trafficDomainScopeKey } from "./traffic-state";

type Metric = "cv" | "sessions" | "cvr";
export function ConversionKpis({ metrics, cvrSupported }: { metrics: ConversionMetrics; cvrSupported: boolean }) {
	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{[
				{ label: t("conversions.aiSessions"), value: conversionNumber(metrics.aiSessions) },
				{
					label: t("conversions.aiCv"),
					value: conversionNumber(metrics.aiCv),
					description: `${t("conversions.aiCvSessions")}: ${conversionNumber(metrics.aiCvSessions)}`,
				},
				{ label: t("conversions.aiCvr"), value: conversionRate(cvrSupported ? metrics.aiCvr : null) },
				{ label: t("conversions.allCv"), value: conversionNumber(metrics.cv) },
			].map((item) => (
				<div key={item.label} className="rounded-xl border bg-card p-5">
					<p className="text-sm font-medium">{item.label}</p>
					<p className="mt-2 text-3xl font-semibold tabular-nums">{item.value}</p>
					{item.description && <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>}
				</div>
			))}
		</div>
	);
}
export function ConversionNotices({ report }: { report: ConversionReport }) {
	return (
		<div className="space-y-3">
			{report.measurementScope === "cv_event_host" && (
				<aside
					className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
					aria-label={t("conversions.hostScope")}
				>
					<p>{t("conversions.hostScope")}</p>
					{report.pageAttributionSupported && <p className="mt-2 text-xs">{t("conversions.crossHost")}</p>}
				</aside>
			)}
			{!report.cvrSupported && (
				<p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
					{t("conversions.cvrUnavailable")}
				</p>
			)}
			<QualityNotices
				warnings={report.warnings.filter(
					(w) =>
						![
							"cross_host_landing_unverified",
							"cvr_scope_unavailable",
							"observed_session_start",
							"cv_event_host",
						].includes(w),
				)}
			/>
		</div>
	);
}
export function ConversionTrend({ points, cvrSupported }: { points: ConversionPeriod[]; cvrSupported: boolean }) {
	const [metric, setMetric] = useState<Metric>("cv");
	const selected = metric === "cvr" && !cvrSupported ? "cv" : metric;
	const id = useId();
	const labels = sourceLabels();
	const format = (value: number | null | undefined) =>
		selected === "cvr" ? conversionRate(value ?? null) : conversionNumber(value ?? null);
	const data = points.map((point) => ({
		...point,
		...point.providers,
		value: selected === "cv" ? point.aiCv : selected === "sessions" ? point.aiSessions : point.aiCvr,
	}));
	return (
		<TrafficCard
			title={t("conversions.trend")}
			action={
				<label className="flex items-center gap-2 text-xs" htmlFor={id}>
					{t("conversions.metric")}
					<select
						id={id}
						className="h-8 rounded-md border bg-background px-2 text-sm"
						value={selected}
						onChange={(e) => setMetric(e.target.value as Metric)}
					>
						<option value="cv">{t("conversions.cvCount")}</option>
						<option value="sessions" disabled={points.every((p) => p.aiSessions === null)}>
							{t("conversions.aiSessions")}
						</option>
						<option value="cvr" disabled={!cvrSupported}>
							{t("conversions.aiCvr")}
						</option>
					</select>
				</label>
			}
		>
			<div className="h-64 w-full" role="img" aria-label={t("conversions.trend")}>
				<ResponsiveContainer width="100%" height="100%">
					<LineChart accessibilityLayer data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
						<XAxis
							dataKey="date"
							tickFormatter={dateLabel}
							minTickGap={40}
							tickLine={false}
							axisLine={false}
							fontSize={11}
						/>
						<YAxis
							width={55}
							allowDecimals={selected === "cvr"}
							tickLine={false}
							axisLine={false}
							fontSize={11}
							tickFormatter={(value) => format(Number(value))}
						/>
						<Tooltip
							labelFormatter={(label) => String(label)}
							formatter={(value, name) => [format(Number(value)), String(name)]}
							contentStyle={{ borderRadius: 8, borderColor: "var(--border)", fontSize: 12 }}
						/>
						<Line
							dataKey="value"
							name={t(
								selected === "cv"
									? "conversions.aiCv"
									: selected === "sessions"
										? "conversions.aiSessions"
										: "conversions.aiCvr",
							)}
							stroke={sourceColors.ai}
							strokeWidth={2}
							dot={points.length === 1}
							connectNulls={false}
							isAnimationActive={false}
						/>
						{selected === "cv" && (
							<Line
								dataKey="cv"
								name={t("conversions.allCv")}
								stroke="#a1a1aa"
								strokeWidth={1.5}
								strokeDasharray="5 4"
								dot={false}
								isAnimationActive={false}
							/>
						)}
						{selected === "cv" &&
							AI_PROVIDERS.map((provider) => (
								<Line
									key={provider}
									dataKey={provider}
									name={labels[provider]}
									stroke={sourceColors[provider]}
									strokeWidth={1.5}
									dot={false}
									isAnimationActive={false}
								/>
							))}
					</LineChart>
				</ResponsiveContainer>
			</div>
			<div className="mt-3 flex flex-wrap justify-center gap-3 text-xs">
				<span className="flex items-center gap-1">
					<span className="size-2 rounded-full" style={{ background: sourceColors.ai }} />
					{t(
						selected === "cv"
							? "conversions.aiCv"
							: selected === "sessions"
								? "conversions.aiSessions"
								: "conversions.aiCvr",
					)}
				</span>
				{selected === "cv" && (
					<span className="flex items-center gap-1">
						<span className="w-4 border-t-2 border-dashed border-[#a1a1aa]" />
						{t("conversions.allCv")}
					</span>
				)}
				{selected === "cv" &&
					AI_PROVIDERS.map((provider) => (
						<span key={provider} className="flex items-center gap-1">
							<span className="size-2 rounded-full" style={{ background: sourceColors[provider] }} />
							{labels[provider]}
						</span>
					))}
			</div>
		</TrafficCard>
	);
}
function ConversionPeriodTable({ report }: { report: ConversionReport }) {
	return (
		<TrafficCard title={t("conversions.periods")}>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-xs text-muted-foreground">
							<th scope="col" className="p-3 text-left">
								{t("conversions.date")}
							</th>
							<th scope="col" className="p-3 text-right">
								{t("conversions.aiCv")}
							</th>
							<th scope="col" className="p-3 text-right">
								{t("conversions.allCv")}
							</th>
							<th scope="col" className="p-3 text-right">
								{t("conversions.aiSessions")}
							</th>
							<th scope="col" className="p-3 text-right">
								{t("conversions.aiCvSessions")}
							</th>
							<th scope="col" className="p-3 text-right">
								{t("conversions.aiCvr")}
							</th>
						</tr>
					</thead>
					<tbody>
						{report.points.map((point) => (
							<tr key={point.date} className="border-b last:border-0">
								<th scope="row" className="p-3 text-left font-normal tabular-nums">
									{point.date}
								</th>
								<td className="p-3 text-right tabular-nums">{conversionNumber(point.aiCv)}</td>
								<td className="p-3 text-right tabular-nums">{conversionNumber(point.cv)}</td>
								<td className="p-3 text-right tabular-nums">{conversionNumber(point.aiSessions)}</td>
								<td className="p-3 text-right tabular-nums">{conversionNumber(point.aiCvSessions)}</td>
								<td className="p-3 text-right tabular-nums">
									{conversionRate(report.cvrSupported ? point.aiCvr : null)}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr className="border-t font-medium">
							<th scope="row" className="p-3 text-left">
								{t("traffic.periodTotal")}
							</th>
							<td className="p-3 text-right tabular-nums">{conversionNumber(report.totals.aiCv)}</td>
							<td className="p-3 text-right tabular-nums">{conversionNumber(report.totals.cv)}</td>
							<td className="p-3 text-right tabular-nums">{conversionNumber(report.totals.aiSessions)}</td>
							<td className="p-3 text-right tabular-nums">{conversionNumber(report.totals.aiCvSessions)}</td>
							<td className="p-3 text-right tabular-nums">
								{conversionRate(report.cvrSupported ? report.totals.aiCvr : null)}
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</TrafficCard>
	);
}
function ConversionSourceTable({ report }: { report: ConversionReport }) {
	const labels = sourceLabels();
	return (
		<TrafficCard title={t("conversions.aiSources")}>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-xs text-muted-foreground">
							{[
								t("conversions.source"),
								t("conversions.sessions"),
								t("conversions.cvCount"),
								t("conversions.cvSessions"),
								t("conversions.cvr"),
							].map((label, index) => (
								<th key={label} scope="col" className={`p-3 ${index ? "text-right" : "text-left"}`}>
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{report.sources.map((row) => (
							<tr key={row.provider} className="border-b last:border-0">
								<th scope="row" className="p-3 text-left font-medium">
									<span className="inline-flex items-center gap-2">
										<span className="size-2 rounded-full" style={{ background: sourceColors[row.provider] }} />
										{labels[row.provider]}
									</span>
								</th>
								<td className="p-3 text-right tabular-nums">{conversionNumber(row.sessions)}</td>
								<td className="p-3 text-right tabular-nums">{conversionNumber(row.cv)}</td>
								<td className="p-3 text-right tabular-nums">{conversionNumber(row.cvSessions)}</td>
								<td className="p-3 text-right tabular-nums">{conversionRate(report.cvrSupported ? row.cvr : null)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</TrafficCard>
	);
}
export function ConversionPages({
	report,
	search,
	onSearch,
	onDetail,
}: {
	report: ConversionReport;
	search: TrafficSearch;
	onSearch: (patch: Partial<TrafficSearch>) => void;
	onDetail: (path: string) => void;
}) {
	const [query, setQuery] = useState(search.pageSearch ?? "");
	const id = useId();
	const pages = report.pages;
	const totalPages = Math.max(1, Math.ceil(pages.totalRows / pages.pageSize));
	return (
		<TrafficCard
			title={t(report.measurementScope === "cv_event_host" ? "conversions.hostPageTitle" : "conversions.pageTitle")}
			action={
				<form
					className="flex flex-wrap items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						onSearch({ pageSearch: query || undefined, page: undefined });
					}}
				>
					<Input
						aria-label={t("conversions.search")}
						placeholder={t("conversions.search")}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="h-8 w-48"
					/>
					<Button variant="outline" type="submit" size="sm">
						{t("conversions.apply")}
					</Button>
					<label htmlFor={id} className="sr-only">
						{t("conversions.pageSize")}
					</label>
					<select
						id={id}
						className="h-8 rounded-md border bg-background px-2 text-sm"
						value={pages.pageSize}
						onChange={(e) => onSearch({ pageSize: Number(e.target.value) as 5 | 10 | 25 | 50, page: undefined })}
					>
						{[5, 10, 25, 50].map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</form>
			}
		>
			{!report.pageAttributionSupported ? (
				<p className="text-sm text-muted-foreground">{t("conversions.pageUnsupported")}</p>
			) : (
				<>
					{pages.rows.some((row) => (row.pageIdentities?.length ?? 0) > 1) && (
						<p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("conversions.sharedPathPages")}</p>
					)}
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-xs text-muted-foreground">
									{[
										t("traffic.pageIdentity"),
										t("conversions.aiCv"),
										t("conversions.allCv"),
										t("conversions.aiSessions"),
										t("conversions.aiCvr"),
										t("conversions.detail"),
									].map((label, index) => (
										<th key={label} scope="col" className={`p-3 ${index ? "text-right" : "text-left"}`}>
											{label}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{pages.rows.map((row) => (
									<tr key={row.path} className="border-b last:border-0">
										<th scope="row" className="w-[42%] min-w-64 max-w-lg p-3 text-left font-normal">
											{row.path.startsWith("/") && row.pageIdentities?.length ? (
												<div className="space-y-3">
													{row.pageIdentities.map((identity) => {
														const url = `https://${identity.hostname}${row.path}`;
														return (
															<div key={identity.hostname}>
																<span className="block break-words font-semibold leading-relaxed">
																	{identity.title || t("traffic.titleUnavailable")}
																</span>
																<a
																	href={url}
																	target="_blank"
																	rel="noopener noreferrer"
																	aria-label={t("traffic.openPageInNewTab", { url })}
																	className="mt-1 block break-all rounded-sm text-xs leading-relaxed text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
																>
																	{url}
																</a>
															</div>
														);
													})}
												</div>
											) : (
												<>
													<span className="block font-semibold leading-relaxed">{t("traffic.titleUnavailable")}</span>
													<span className="mt-1 block break-all text-xs leading-relaxed text-muted-foreground">
														{row.path}
													</span>
												</>
											)}
										</th>
										<td className="p-3 text-right tabular-nums">{conversionNumber(row.aiCv)}</td>
										<td className="p-3 text-right tabular-nums">{conversionNumber(row.cv)}</td>
										<td className="p-3 text-right tabular-nums">{conversionNumber(row.aiSessions)}</td>
										<td className="p-3 text-right tabular-nums">
											{conversionRate(report.cvrSupported ? row.aiCvr : null)}
										</td>
										<td className="p-3 text-right">
											<Button
												size="sm"
												variant="ghost"
												disabled={!row.path.startsWith("/")}
												onClick={() => onDetail(row.path)}
												aria-label={`${t("conversions.detail")}: ${row.path}`}
											>
												{t("conversions.detail")} ›
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{!pages.rows.length && (
							<p className="py-8 text-center text-sm text-muted-foreground">{t("conversions.noPages")}</p>
						)}
					</div>
					<div className="mt-4 flex flex-wrap items-center justify-end gap-3">
						<Button
							variant="outline"
							size="sm"
							disabled={pages.page <= 1}
							onClick={() => onSearch({ page: pages.page - 1 })}
						>
							{t("conversions.previous")}
						</Button>
						<span className="text-xs tabular-nums">
							{pages.page} / {totalPages} · {formatNumber(pages.totalRows)}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={pages.page >= totalPages}
							onClick={() => onSearch({ page: pages.page + 1 })}
						>
							{t("conversions.next")}
						</Button>
					</div>
				</>
			)}
		</TrafficCard>
	);
}
function ConversionResults({
	report,
	search,
	onSearch,
	onDetail,
	detail = false,
}: {
	report: ConversionReport;
	search: TrafficSearch;
	onSearch: (patch: Partial<TrafficSearch>) => void;
	onDetail?: (path: string) => void;
	detail?: boolean;
}) {
	return (
		<>
			<ConversionNotices report={report} />
			<ConversionKpis metrics={report.totals} cvrSupported={report.cvrSupported} />
			{report.totals.cv === 0 && (
				<p role="status" className="rounded-lg border bg-muted/30 p-4 text-sm">
					{t("conversions.noCv")}
				</p>
			)}
			<ConversionTrend points={report.points} cvrSupported={report.cvrSupported} />
			<ConversionSourceTable report={report} />
			<ConversionPeriodTable report={report} />
			{!detail && onDetail && (
				<ConversionPages
					key={`${search.pageSearch ?? ""}:${search.pageSize ?? 10}`}
					report={report}
					search={search}
					onSearch={onSearch}
					onDetail={onDetail}
				/>
			)}
			<div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
				<p>{t("conversions.cvrDefinition")}</p>
				<p>{t("conversions.attribution")}</p>
				<p>{t("conversions.beforeRegistration")}</p>
				<p>
					{t("conversions.lastFetched")}:{" "}
					{new Intl.DateTimeFormat(UI_LOCALE, {
						dateStyle: "short",
						timeStyle: "short",
						timeZone: report.timeZone,
					}).format(new Date(report.fetchedAt))}{" "}
					· {report.timeZone}
				</p>
			</div>
		</>
	);
}
export function ConversionAnalysis({
	brandId,
	status,
	request,
	enabled,
	search,
	onSearch,
}: {
	brandId: string;
	status: TrafficConnectionStatus;
	request: TrafficRequest;
	enabled: boolean;
	search: TrafficSearch;
	onSearch: (patch: Partial<TrafficSearch>, replace?: boolean) => void | Promise<void>;
}) {
	const client = useQueryClient();
	const id = useId();
	const [settings, setSettings] = useState(false);
	const returnFocus = useRef<HTMLElement | null>(null);
	const hostname = request.hostname ?? "all";
	const domainScopeKey = trafficDomainScopeKey(status.availableSites, hostname);
	const goals = useQuery({
		queryKey: [
			"traffic-conversion-goals",
			brandId,
			status.propertyId,
			status.hostname,
			status.connectionRevision,
			trafficDomainScopeKey(status.availableSites),
		],
		queryFn: () => listConversionGoalsFn({ data: { brandId } }),
		enabled: !!status.connected,
		retry: false,
		refetchOnWindowFocus: false,
		staleTime: 30000,
	});
	const available = (goals.data ?? []).filter(
		(goal) => goal.propertyId === status.propertyId && status.availableSites.includes(goal.hostname),
	);
	const resolved = resolveConversionSelection(search.conversionGoalId, available, hostname);
	const goal = resolved.goal;
	const hasGoals = resolved.options.length > 0;
	const goalRevisions = conversionGoalRevisionKey(available, hostname, goal?.eventName);
	const reportRequest = {
		...request,
		goalId: resolved.id,
		grain: search.grain ?? ("day" as const),
		page: search.page ?? 1,
		pageSize: search.pageSize ?? 10,
		pageSearch: search.pageSearch ?? "",
	};
	const report = useQuery({
		queryKey: [
			"traffic-conversions",
			domainScopeKey,
			status.propertyId,
			status.hostname,
			status.connectionRevision,
			goalRevisions,
			status.measurementMode,
			reportRequest,
		],
		queryFn: () => getConversionReportFn({ data: reportRequest }),
		enabled: enabled && hasGoals && !resolved.invalid,
		retry: false,
		refetchOnWindowFocus: false,
		staleTime: 30 * 60000,
	});
	const detailPath = search.detail?.startsWith("/") ? search.detail : undefined;
	const detail = useQuery({
		queryKey: [
			"traffic-conversion-detail",
			domainScopeKey,
			status.propertyId,
			status.hostname,
			status.connectionRevision,
			goalRevisions,
			status.measurementMode,
			reportRequest,
			detailPath,
		],
		queryFn: () => getConversionReportFn({ data: { ...reportRequest, detail: detailPath, page: 1, pageSearch: "" } }),
		enabled: enabled && hasGoals && !resolved.invalid && !!detailPath && report.data?.pageAttributionSupported === true,
		retry: false,
		refetchOnWindowFocus: false,
		staleTime: 30 * 60000,
	});
	async function changed(saved?: ConversionGoal) {
		await client.invalidateQueries({
			predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("traffic-conversion"),
		});
		if (saved?.enabled && (hostname === "all" || saved.hostname === hostname))
			await onSearch(scopeChange({ conversionGoalId: saved.id }));
	}
	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<label htmlFor={id} className="flex items-center gap-3 text-sm">
					{t("conversions.choose")}
					<select
						id={id}
						className="h-9 max-w-64 rounded-md border bg-background px-3"
						value={resolved.id}
						onChange={(e) => void onSearch(scopeChange({ conversionGoalId: e.target.value || undefined }))}
					>
						<option value="all">{t("conversions.allGoals")}</option>
						{resolved.options.map((item) => (
							<option key={item.id} value={item.id}>
								{item.displayName}
							</option>
						))}
					</select>
				</label>
				<Button variant="outline" size="sm" onClick={() => setSettings(true)}>
					{t("conversions.settings")}
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">{t("conversions.landingScope")}</p>
			{goals.isPending && <TrafficLoading />}
			{goals.isError && <TrafficError error={goals.error} retry={() => void goals.refetch()} />}
			{goals.data && resolved.invalid && (
				<p role="alert" className="rounded-lg border p-4 text-sm">
					{t("conversions.unavailableGoal")}
				</p>
			)}
			{goals.data && !goals.isError && !hasGoals && !resolved.invalid && (
				<TrafficCard>
					<div className="space-y-3 py-8 text-center">
						<h2 className="text-xl font-semibold">{t("conversions.empty")}</h2>
						<p className="text-sm text-muted-foreground">{t("conversions.emptyHelp")}</p>
						{status.canManage ? (
							<Button onClick={() => setSettings(true)}>{t("conversions.add")}</Button>
						) : (
							<p className="text-sm">{t("conversions.ownerRequired")}</p>
						)}
					</div>
				</TrafficCard>
			)}
			{hasGoals && !resolved.invalid && enabled && (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-xs text-muted-foreground">
							{request.from} – {request.to} · {status.timeZone}
						</p>
						<div className="flex items-center gap-2">
							<GrainToggle value={search.grain ?? "day"} onChange={(grain) => void onSearch({ grain })} />
							<Button size="sm" variant="ghost" disabled={report.isFetching} onClick={() => void report.refetch()}>
								{t("traffic.retry")}
							</Button>
						</div>
					</div>
					{report.isPending && <TrafficLoading />}
					{report.isError && <TrafficError error={report.error} retry={() => void report.refetch()} />}
					{report.isFetching && report.data && (
						<p role="status" className="text-xs text-muted-foreground">
							{t("traffic.updating")}
						</p>
					)}
					{report.data && !report.isError && (
						<ConversionResults
							report={report.data}
							search={search}
							onSearch={onSearch}
							onDetail={(path) => {
								returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
								void onSearch({ detail: path });
							}}
						/>
					)}
				</>
			)}
			{settings && (
				<ConversionSettings
					brandId={brandId}
					scopeKey={`${status.propertyId}:${status.hostname}:${status.connectionRevision}`}
					goals={available}
					hostname={hostname === "all" ? status.hostname : hostname}
					availableSites={status.availableSites}
					canManage={status.canManage}
					onClose={() => setSettings(false)}
					onChanged={changed}
				/>
			)}
			{detailPath && hasGoals && !resolved.invalid && enabled && report.data?.pageAttributionSupported && (
				<Sheet open onOpenChange={(open) => !open && void onSearch({ detail: undefined })}>
					<SheetContent
						className="w-full overflow-y-auto sm:max-w-3xl"
						onCloseAutoFocus={(event) => {
							if (returnFocus.current?.isConnected) {
								event.preventDefault();
								returnFocus.current.focus();
							}
						}}
					>
						<SheetHeader>
							<SheetTitle>{t("conversions.detailTitle")}</SheetTitle>
							<SheetDescription>
								{goal?.displayName ?? t("conversions.allGoals")} · {request.from} – {request.to}
							</SheetDescription>
						</SheetHeader>
						<div className="space-y-5 px-4 pb-6">
							<code className="block break-all rounded-lg border p-3 text-sm">{detailPath}</code>
							<GrainToggle value={search.grain ?? "day"} onChange={(grain) => void onSearch({ grain })} />
							{detail.isPending && <TrafficLoading />}
							{detail.isError && <TrafficError error={detail.error} retry={() => void detail.refetch()} />}
							{detail.data && !detail.isError && (
								<ConversionResults report={detail.data} search={search} onSearch={onSearch} detail />
							)}
							<Button variant="outline" onClick={() => void onSearch({ detail: undefined })}>
								{t("conversions.close")}
							</Button>
						</div>
					</SheetContent>
				</Sheet>
			)}
		</div>
	);
}
