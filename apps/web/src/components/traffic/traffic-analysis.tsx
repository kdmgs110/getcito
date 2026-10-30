import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AI_CLASSIFICATION_VERSION,
	ANALYTICS_MEASUREMENT_VERSION,
	aggregateTrafficPoints,
	defaultTrafficRange,
	FILTER_SCHEMA_VERSION,
	normalizeConditions,
	type SavedTrafficView,
	type TrafficCondition,
} from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { BookmarkPlus, ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { t, UI_LOCALE } from "@/i18n";
import { getTrafficConnectionFn, getTrafficOverviewFn, getTrafficPagesFn } from "@/server/traffic";
import {
	deleteTrafficViewFn,
	listTrafficViewsFn,
	reorderTrafficViewsFn,
	saveTrafficViewFn,
} from "@/server/traffic-saved-views";
import { ConditionEditor } from "./condition-editor";
import { ConnectionSettings } from "./connection-settings";
import { ConversionAnalysis } from "./conversion-analysis";
import { PageTrafficDetail } from "./page-traffic-detail";
import { PageTrafficTable } from "./page-traffic-table";
import { QualityNotices } from "./quality-notices";
import { SavedViewDialog, type ViewDialogState } from "./saved-view-dialog";
import { SavedViewManager } from "./saved-view-manager";
import { SavedViewSwitcher } from "./saved-view-switcher";
import { TrafficCard, TrafficError, TrafficLoading, trafficError } from "./shared";
import { GrainToggle, TrafficChart, TrafficKpis, TrafficPeriodTable } from "./traffic-chart";
import {
	MeasurementNotice,
	TrafficMeasurementContext,
	trafficMeasurementLabels,
	useTrafficMeasurement,
} from "./traffic-measurement";
import {
	duplicateViewDraft,
	newViewDraft,
	resolveViewConditions,
	sameConditions,
	scopeChange,
	type TrafficSearch,
	trafficDomainScopeKey,
	validDateRange,
	viewStorageKey,
} from "./traffic-state";

function FilterForm({
	conditions,
	title,
	hostname,
	canManage,
	onApply,
	onSave,
}: {
	conditions: TrafficCondition[];
	title?: string;
	hostname: string | string[];
	canManage: boolean;
	onApply: (value: TrafficCondition[]) => void;
	onSave: () => void;
}) {
	const measurement = useTrafficMeasurement();
	const [draft, setDraft] = useState(conditions);
	const [error, setError] = useState<string>();
	const dirty = !sameConditions(draft, conditions);
	function apply() {
		setError(undefined);
		try {
			onApply(normalizeConditions(draft, hostname));
		} catch {
			setError(t("traffic.conditionInvalid"));
		}
	}
	return (
		<TrafficCard
			title={title ?? measurement.targetPages}
			action={
				canManage && (
					<Button size="sm" variant="outline" disabled={dirty} onClick={onSave}>
						<BookmarkPlus className="size-4" />
						{t("traffic.registerCurrent")}
					</Button>
				)
			}
		>
			<form
				aria-label={title ?? measurement.targetPages}
				onSubmit={(event) => {
					event.preventDefault();
					apply();
				}}
			>
				<ConditionEditor value={draft} onChange={setDraft} />
				<div className="mt-4 flex flex-wrap items-center justify-end gap-2">
					<Button
						variant="ghost"
						type="button"
						size="sm"
						onClick={() => {
							setDraft([]);
							setError(undefined);
							onApply([]);
						}}
					>
						{t("traffic.clear")}
					</Button>
					<Button size="sm" type="submit">
						{t("traffic.apply")}
					</Button>
				</div>
				{dirty && canManage && <p className="mt-2 text-xs text-muted-foreground">{t("traffic.pendingApply")}</p>}
				{error && (
					<p className="mt-2 text-sm text-destructive" role="alert">
						{error}
					</p>
				)}
			</form>
		</TrafficCard>
	);
}
function DateRangeForm({
	from,
	to,
	timeZone,
	onApply,
}: {
	from: string;
	to: string;
	timeZone: string;
	onApply: (from: string, to: string) => void;
}) {
	const id = useId();
	const [start, setStart] = useState(from);
	const [end, setEnd] = useState(to);
	const [error, setError] = useState(false);
	return (
		<form
			aria-label={t("traffic.period")}
			className="flex flex-wrap items-end gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				const valid = validDateRange(start, end);
				setError(!valid);
				if (valid) onApply(start, end);
			}}
		>
			<label htmlFor={`${id}-from`} className="space-y-1 text-xs text-muted-foreground">
				{t("traffic.from")}
				<Input
					id={`${id}-from`}
					type="date"
					value={start}
					onChange={(e) => setStart(e.target.value)}
					required
					className="mt-1 w-36 text-foreground"
				/>
			</label>
			<label htmlFor={`${id}-to`} className="space-y-1 text-xs text-muted-foreground">
				{t("traffic.to")}
				<Input
					id={`${id}-to`}
					type="date"
					value={end}
					onChange={(e) => setEnd(e.target.value)}
					required
					className="mt-1 w-36 text-foreground"
				/>
			</label>
			<Button variant="outline" type="submit" size="sm">
				{t("traffic.apply")}
			</Button>
			<Button
				variant="ghost"
				type="button"
				size="sm"
				onClick={() => {
					const range = defaultTrafficRange(timeZone);
					setStart(range.from);
					setEnd(range.to);
					setError(false);
					onApply(range.from, range.to);
				}}
			>
				{t("traffic.last28")}
			</Button>
			{error && (
				<p role="alert" className="w-full text-xs text-destructive">
					{t("traffic.dateInvalid")}
				</p>
			)}
		</form>
	);
}

export function TrafficAnalysis({
	brandId,
	search,
	onSearch,
}: {
	brandId: string;
	search: TrafficSearch;
	onSearch: (patch: Partial<TrafficSearch>, replace?: boolean) => void | Promise<void>;
}) {
	const client = useQueryClient();
	const [settings, setSettings] = useState(false);
	const [manager, setManager] = useState(false);
	const [viewDialog, setViewDialog] = useState<ViewDialogState>();
	const [notice, setNotice] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const [preferencesReady, setPreferencesReady] = useState(false);
	const initialized = useRef(false);
	const detailReturnFocus = useRef<HTMLElement | null>(null);
	const [savedFromDetail, setSavedFromDetail] = useState<SavedTrafficView>();
	const connection = useQuery({
		queryKey: ["traffic-connection", brandId],
		queryFn: () => getTrafficConnectionFn({ data: { brandId } }),
		staleTime: 30000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const views = useQuery({
		queryKey: ["traffic-views", brandId],
		queryFn: () => listTrafficViewsFn({ data: { brandId } }),
		enabled: !!connection.data,
		staleTime: 30000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const status = connection.data;
	const hostname = search.hostname ?? views.data?.find((view) => view.id === search.viewId)?.hostname ?? "all";
	const combined = hostname === "all";
	const domainScopeKey = trafficDomainScopeKey(status?.availableSites ?? [], hostname);
	const domainValid = combined || !!status?.availableSites.includes(hostname);
	const scope = resolveViewConditions(search, views.data ?? [], hostname);
	const selected = scope.view;
	const conditions = scope.conditions;
	const analysisTab = search.analysisTab ?? selected?.analysisTab ?? "traffic";
	const conversionGoalId = search.conversionGoalId ?? selected?.conversionGoalId ?? undefined;
	const effectiveSearch = { ...search, hostname, analysisTab, conversionGoalId };
	const dirty =
		!!selected &&
		(!sameConditions(conditions, selected.conditions) ||
			analysisTab !== (selected.analysisTab ?? "traffic") ||
			(conversionGoalId === "all" ? null : (conversionGoalId ?? null)) !== (selected.conversionGoalId ?? null));
	const timeZone = status?.timeZone ?? "UTC";
	const measurementMode =
		(combined && (status?.availableSites.length ?? 0) > 1) || (!combined && hostname !== status?.hostname)
			? "observed_session_start"
			: (status?.measurementMode ?? "landing_sessions");
	const measurement = trafficMeasurementLabels(measurementMode);
	const range = defaultTrafficRange(timeZone);
	const from = search.from ?? range.from;
	const to = search.to ?? range.to;
	const grain = search.grain ?? "day";
	const chart = search.chart ?? "total";
	const dateValid = validDateRange(from, to);
	const request = { brandId, hostname, from, to, conditions };
	const enabled =
		!!status?.configured &&
		!!status?.connected &&
		!!status.connectionRevision &&
		!status.needsReconnect &&
		preferencesReady &&
		!scope.invalidView &&
		domainValid &&
		dateValid &&
		!views.isError;
	const overview = useQuery({
		queryKey: [
			"traffic-overview",
			domainScopeKey,
			status?.propertyId,
			status?.hostname,
			status?.connectionRevision,
			measurementMode,
			ANALYTICS_MEASUREMENT_VERSION,
			AI_CLASSIFICATION_VERSION,
			FILTER_SCHEMA_VERSION,
			request,
		],
		queryFn: () => getTrafficOverviewFn({ data: request }),
		enabled: enabled && analysisTab === "traffic",
		staleTime: 30 * 60000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const pagesRequest = {
		...request,
		page: search.page ?? 1,
		pageSize: search.pageSize ?? 10,
		pageSearch: search.pageSearch ?? "",
		pageScope: search.pageScope ?? ("ai" as const),
	};
	const pages = useQuery({
		queryKey: [
			"traffic-pages",
			domainScopeKey,
			status?.propertyId,
			status?.hostname,
			status?.connectionRevision,
			measurementMode,
			ANALYTICS_MEASUREMENT_VERSION,
			AI_CLASSIFICATION_VERSION,
			FILTER_SCHEMA_VERSION,
			pagesRequest,
		],
		queryFn: () => getTrafficPagesFn({ data: pagesRequest }),
		enabled: enabled && analysisTab === "traffic",
		staleTime: 30 * 60000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	useEffect(() => {
		if (!status || !views.data || initialized.current) return;
		initialized.current = true;
		if (hostname !== "all" && !search.viewId && !search.conditions) {
			try {
				const previous = localStorage.getItem(viewStorageKey(status.userId, brandId));
				if (previous && views.data.some((view) => view.id === previous && view.hostname === hostname))
					onSearch({ viewId: previous }, true);
			} catch {
				/* Storage can be disabled by the browser. */
			}
		}
		setPreferencesReady(true);
	}, [status, views.data, brandId, search.viewId, search.conditions, hostname, onSearch]);
	useEffect(() => {
		if (status && views.data && scope.invalidView) {
			setNotice(t("traffic.invalidView"));
			onSearch(scopeChange({ viewId: undefined, conditions: undefined }), true);
		}
	}, [status, views.data, scope.invalidView, onSearch]);
	useEffect(() => {
		if (!status || !preferencesReady || scope.invalidView) return;
		try {
			if (search.viewId) localStorage.setItem(viewStorageKey(status.userId, brandId), search.viewId);
			else localStorage.removeItem(viewStorageKey(status.userId, brandId));
		} catch {
			/* Optional preference only. */
		}
	}, [status, preferencesReady, scope.invalidView, search.viewId, brandId]);
	const selectView = (id?: string) => {
		setNotice(undefined);
		const view = views.data?.find((item) => item.id === id);
		return onSearch(
			scopeChange({
				viewId: id,
				hostname: view?.hostname ?? hostname,
				conditions: undefined,
				ga4: undefined,
				analysisTab: id ? (view?.analysisTab ?? "traffic") : analysisTab,
				conversionGoalId: id ? (view?.conversionGoalId ?? undefined) : conversionGoalId,
			}),
		);
	};
	const refreshViews = async () => {
		await client.invalidateQueries({ queryKey: ["traffic-views", brandId] });
	};
	async function saveView(value: { name: string; conditions: TrafficCondition[] }, initial?: ViewDialogState) {
		if (!status || combined) return;
		const saved = await saveTrafficViewFn({
			data: {
				brandId,
				hostname,
				...value,
				analysisTab: initial?.analysisTab ?? initial?.view?.analysisTab ?? analysisTab,
				conversionGoalId:
					initial && "conversionGoalId" in initial
						? initial.conversionGoalId
						: initial?.view
							? (initial.view.conversionGoalId ?? null)
							: (conversionGoalId ?? null),
				...(initial?.view ? { id: initial.view.id, revision: initial.view.revision } : {}),
			},
		});
		await refreshViews();
		if (initial?.keepDetail) setSavedFromDetail(saved);
		else
			await onSearch(
				scopeChange({
					viewId: saved.id,
					conditions: undefined,
					analysisTab: saved.analysisTab ?? "traffic",
					conversionGoalId: saved.conversionGoalId ?? undefined,
				}),
			);
		setNotice(t("traffic.savedSuccess"));
	}
	async function saveChanges() {
		if (!selected) return;
		setActionError(undefined);
		try {
			await saveView(
				{ name: selected.name, conditions },
				{ view: selected, name: selected.name, conditions, analysisTab, conversionGoalId: conversionGoalId ?? null },
			);
		} catch (e) {
			setActionError(trafficError(e));
		}
	}
	async function connectionChanged() {
		onSearch(
			scopeChange({
				hostname: "all",
				viewId: undefined,
				conditions: undefined,
				analysisTab: "traffic",
				conversionGoalId: undefined,
			}),
		);
		await client.invalidateQueries({
			predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("traffic-"),
		});
	}
	if (connection.isPending)
		return (
			<div className="min-w-0">
				<TrafficLoading />
			</div>
		);
	if (connection.isError || !status)
		return (
			<div className="min-w-0">
				<TrafficError error={connection.error} retry={() => connection.refetch()} />
			</div>
		);
	return (
		<TrafficMeasurementContext.Provider value={measurementMode}>
			<div className="min-w-0 space-y-5">
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="text-balance text-2xl font-semibold">{t("traffic.title")}</h1>
						<p className="mt-2 text-pretty text-sm text-muted-foreground">{t("traffic.description")}</p>
					</div>
					<div className="flex items-center gap-3">
						{status.connected && (
							<span className="flex items-center gap-2 text-xs">
								<span className="size-2 rounded-full bg-emerald-500" />
								{t("traffic.connected")}
							</span>
						)}
						<Button variant="outline" size="sm" onClick={() => setSettings(true)}>
							{t("traffic.settings")}
						</Button>
					</div>
				</header>
				<Tabs
					value={analysisTab}
					onValueChange={(value) => onSearch(scopeChange({ analysisTab: value as "traffic" | "conversions" }))}
				>
					<TabsList aria-label={t("traffic.title")}>
						<TabsTrigger value="traffic">{t("conversions.trafficTab")}</TabsTrigger>
						<TabsTrigger value="conversions">{t("conversions.tab")}</TabsTrigger>
					</TabsList>
				</Tabs>
				{search.ga4 && (search.ga4 !== "connected" || !status.connected) && (
					<p role="status" className="rounded-lg border p-3 text-sm">
						{t(search.ga4 === "connected" ? "traffic.oauthSuccess" : "traffic.oauthError")}
					</p>
				)}
				{notice && (
					<p role="status" className="rounded-lg border p-3 text-sm">
						{notice}
					</p>
				)}
				{actionError && (
					<p role="alert" className="text-sm text-destructive">
						{actionError}
					</p>
				)}
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
						<div>
							<label className="mb-1 block text-xs text-muted-foreground" htmlFor="traffic-domain">
								{t("traffic.domainFilter")}
							</label>
							<select
								id="traffic-domain"
								value={hostname}
								className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
								onChange={(event) => {
									setManager(false);
									setViewDialog(undefined);
									setSavedFromDetail(undefined);
									void onSearch(
										scopeChange({
											hostname: event.target.value,
											viewId: undefined,
											conditions: undefined,
											conversionGoalId: undefined,
										}),
									);
								}}
							>
								<option value="all">{t("traffic.allDomains")}</option>
								{status.availableSites.map((site) => (
									<option key={site} value={site}>
										{site}
									</option>
								))}
							</select>
							{combined && <p className="mt-1 text-xs text-muted-foreground">{status.availableSites.join(" + ")}</p>}
						</div>
						<div>
							<p className="mb-1 text-xs text-muted-foreground">{t("traffic.property")}</p>
							<p>{status.propertyName ?? "—"}</p>
						</div>
					</div>
					<DateRangeForm
						key={`${from}-${to}`}
						from={from}
						to={to}
						timeZone={timeZone}
						onApply={(start, end) => onSearch(scopeChange({ from: start, to: end }))}
					/>
				</div>
				{status.connected && analysisTab === "traffic" && <MeasurementNotice mode={measurementMode} />}
				{!domainValid && (
					<p role="alert" className="text-sm text-destructive">
						{t("traffic.invalidDomain")}
					</p>
				)}
				{views.isError ? (
					<TrafficError error={views.error} retry={() => views.refetch()} />
				) : combined ? (
					<p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
						{t("traffic.domainSavedViewsHelp")}
					</p>
				) : (
					<SavedViewSwitcher
						allPathsLabel={analysisTab === "conversions" ? t("conversions.allPaths") : undefined}
						views={views.data ?? []}
						hostname={hostname}
						selected={selected}
						dirty={dirty}
						canManage={status.canManage}
						onSelect={selectView}
						onCreate={() => setViewDialog(newViewDraft(conditions, analysisTab, conversionGoalId))}
						onManage={() => setManager(true)}
						onSave={saveChanges}
						onRestore={() =>
							onSearch(
								scopeChange({
									conditions: undefined,
									analysisTab: selected?.analysisTab ?? "traffic",
									conversionGoalId: selected?.conversionGoalId ?? undefined,
								}),
							)
						}
					/>
				)}
				{!status.configured || !status.connected || status.needsReconnect ? (
					<TrafficCard>
						<div className="mx-auto max-w-xl space-y-4 py-10 text-center">
							<ChartNoAxesCombined className="mx-auto size-10 text-muted-foreground" />
							<h2 className="text-balance text-xl font-semibold">
								{status.needsReconnect ? t("traffic.reauth") : t("traffic.notConnected")}
							</h2>
							<p className="text-pretty text-sm leading-relaxed text-muted-foreground">
								{t("traffic.connectDescription")}
							</p>
							{!status.canManage ? (
								<p className="text-sm">{t("traffic.ownerRequired")}</p>
							) : !status.configured ? (
								<>
									<p className="text-sm">{t("traffic.configRequired")}</p>
									<Button variant="outline" onClick={() => setSettings(true)}>
										{t("traffic.settings")}
									</Button>
								</>
							) : (
								<Button onClick={() => setSettings(true)}>
									{status.oauthConnected && !status.needsReconnect
										? t("traffic.chooseProperty")
										: status.needsReconnect
											? t("traffic.reconnect")
											: t("traffic.connect")}
								</Button>
							)}
						</div>
					</TrafficCard>
				) : (
					<>
						<FilterForm
							title={analysisTab === "conversions" ? t("conversions.filterTitle") : undefined}
							key={`${hostname}:${JSON.stringify(conditions)}`}
							conditions={conditions}
							hostname={combined ? status.availableSites : hostname}
							canManage={status.canManage && !combined}
							onApply={(parsed) =>
								onSearch(
									scopeChange({
										conditions:
											selected && sameConditions(parsed, selected.conditions) ? undefined : JSON.stringify(parsed),
									}),
								)
							}
							onSave={() => setViewDialog(newViewDraft(conditions, analysisTab, conversionGoalId))}
						/>
						{!dateValid && (
							<p role="alert" className="text-sm text-destructive">
								{t("traffic.dateInvalid")}
							</p>
						)}
						{analysisTab === "conversions" ? (
							<ConversionAnalysis
								key={`${status.propertyId}:${hostname}:${status.connectionRevision}`}
								brandId={brandId}
								status={status}
								request={request}
								enabled={enabled}
								search={effectiveSearch}
								onSearch={onSearch}
							/>
						) : (
							<>
								{enabled && overview.isPending && <TrafficLoading />}
								{overview.isError && <TrafficError error={overview.error} retry={() => overview.refetch()} />}
								{overview.data && enabled && (
									<>
										<div className="flex flex-wrap items-center justify-between gap-3">
											<p className="text-xs text-muted-foreground">
												{from} – {to} · {timeZone}
											</p>
											<div className="flex items-center gap-2">
												<GrainToggle value={grain} onChange={(v) => onSearch({ grain: v })} />
												<Button
													variant="ghost"
													size="icon"
													aria-label={t("traffic.retry")}
													disabled={overview.isFetching}
													onClick={() => {
														void overview.refetch();
														void pages.refetch();
													}}
												>
													<RefreshCw className="size-4" />
												</Button>
											</div>
										</div>
										{overview.isFetching && (
											<p role="status" className="text-xs text-muted-foreground">
												{t("traffic.updating")}
											</p>
										)}
										<TrafficKpis totals={overview.data.totals} />
										<QualityNotices warnings={overview.data.warnings} />
										{overview.data.totals.total === 0 && (
											<div className="rounded-lg bg-muted/30 p-4 text-sm">
												<p className="font-medium">{t("traffic.noData")}</p>
												<p className="mt-1 text-muted-foreground">{t("traffic.noDataHelp")}</p>
											</div>
										)}
										<TrafficChart
											points={aggregateTrafficPoints(overview.data.points, grain, from, to)}
											chart={chart}
											onChartChange={(value) => onSearch({ chart: value })}
										/>
										<TrafficPeriodTable
											data={overview.data}
											grain={grain}
											from={from}
											to={to}
											onGrainChange={(v) => onSearch({ grain: v })}
										/>
									</>
								)}
								{enabled && pages.isPending && <TrafficLoading />}
								{pages.isError && <TrafficError error={pages.error} retry={() => pages.refetch()} />}
								{pages.data && enabled && (
									<>
										<QualityNotices warnings={pages.data.warnings} />
										<PageTrafficTable
											key={`${search.pageSearch ?? ""}:${search.pageScope ?? "ai"}`}
											data={pages.data}
											hostname={combined ? "" : hostname}
											query={search.pageSearch ?? ""}
											pageScope={search.pageScope ?? "ai"}
											pageSize={search.pageSize ?? 10}
											grain={grain}
											from={from}
											to={to}
											onSearch={(value) => onSearch({ pageSearch: value || undefined, page: undefined })}
											onScope={(value) => onSearch({ pageScope: value, page: undefined })}
											onPageSize={(value) => onSearch({ pageSize: value as 5 | 10 | 25 | 50, page: undefined })}
											onPage={(value) => onSearch({ page: value })}
											onDetail={(path, pageHostname) => {
												detailReturnFocus.current =
													document.activeElement instanceof HTMLElement ? document.activeElement : null;
												setSavedFromDetail(undefined);
												onSearch({ detail: path, detailHostname: pageHostname });
											}}
										/>
									</>
								)}
							</>
						)}
					</>
				)}
				<footer className="space-y-2 text-pretty text-xs leading-relaxed text-muted-foreground">
					{analysisTab === "traffic" && <p>{measurement.measurementNote}</p>}
					<p>{t("traffic.provisional")}</p>
					{analysisTab === "traffic" && overview.data && (
						<p>
							{t("traffic.lastFetched")}:{" "}
							{new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "short", timeStyle: "short", timeZone }).format(
								new Date(overview.data.fetchedAt),
							)}{" "}
							· {timeZone}
						</p>
					)}
				</footer>
				{settings && (
					<ConnectionSettings
						brandId={brandId}
						status={status}
						onClose={() => setSettings(false)}
						onChanged={connectionChanged}
					/>
				)}
				{viewDialog && (
					<SavedViewDialog
						key={viewDialog.view?.id ?? viewDialog.name}
						initial={viewDialog}
						hostname={hostname}
						onClose={() => setViewDialog(undefined)}
						onSave={(value) => saveView(value, viewDialog)}
					/>
				)}
				{manager && (
					<SavedViewManager
						views={views.data ?? []}
						hostname={hostname}
						timeZone={timeZone}
						canManage={status.canManage}
						onClose={() => setManager(false)}
						onOpen={(view) => {
							selectView(view.id);
							setManager(false);
						}}
						onEdit={(view) => {
							setManager(false);
							setViewDialog({ view, name: view.name, conditions: view.conditions });
						}}
						onDuplicate={(view) => {
							setManager(false);
							setViewDialog({
								...duplicateViewDraft(view, t("traffic.copyName", { name: view.name })),
								conversionGoalId: view.hostname === hostname ? view.conversionGoalId : null,
							});
						}}
						onDelete={async (view) => {
							await deleteTrafficViewFn({ data: { brandId, id: view.id, revision: view.revision } });
							if (view.id === selected?.id) await selectView();
							await refreshViews();
						}}
						onReorder={async (ids) => {
							await reorderTrafficViewsFn({ data: { brandId, ids } });
							await refreshViews();
						}}
					/>
				)}
				{analysisTab === "traffic" && search.detail?.startsWith("/") && enabled && (
					<PageTrafficDetail
						key={`${search.detailHostname ?? hostname}:${search.detail}`}
						request={{ ...request, detailHostname: search.detailHostname }}
						path={search.detail}
						hostname={search.detailHostname ?? (combined ? t("traffic.allDomains") : hostname)}
						timeZone={timeZone}
						initialGrain={grain}
						connectionKey={`${status.propertyId}:${status.hostname}:${status.connectionRevision}:${domainScopeKey}`}
						measurementMode={measurementMode}
						returnFocus={detailReturnFocus.current}
						registeredView={savedFromDetail}
						onOpenRegistered={selectView}
						canManage={status.canManage && !combined}
						onClose={() => onSearch({ detail: undefined, detailHostname: undefined })}
						onRegister={() =>
							setViewDialog({
								name: (search.detail ?? "").slice(0, 60),
								conditions: [{ mode: "include", operator: "exact", value: search.detail ?? "" }],
								keepDetail: true,
							})
						}
					/>
				)}
			</div>
		</TrafficMeasurementContext.Provider>
	);
}
