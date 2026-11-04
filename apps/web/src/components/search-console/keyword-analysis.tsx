import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AI_QUESTION_REGEX,
	defaultSearchConsoleDates,
	GSC_FILTER_VERSION,
	type GscReport,
	getAiQuestionSignals,
	reportFiltersSchema,
	type SearchConsoleFilters,
} from "@workspace/lib/search-console";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Switch } from "@workspace/ui/components/switch";
import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Download,
	Info,
	Plus,
	Search,
	X,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { t, UI_LOCALE } from "@/i18n";
import { getSearchConsoleReportFn, getSearchConsoleStatusFn } from "@/server/search-console";
import { SearchConsoleSettings } from "./connection-settings";
import { SearchConsoleError, type SearchConsoleStatus, selectClassName } from "./shared";
import { type KeywordSearch, type KeywordSort, keywordCsv, parseUrlConditions, sortKeywordRows } from "./state";

const PAGE_SIZE = 100;
const operators = ["contains", "notContains", "equals", "subtree"] as const;
const number = (value: number) => new Intl.NumberFormat(UI_LOCALE).format(value);
const percent = (value: number) =>
	new Intl.NumberFormat(UI_LOCALE, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
		value,
	);
const position = (value: number) =>
	new Intl.NumberFormat(UI_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

function AiQuestionReasons({ query }: { query: string }) {
	const { score, reasons } = getAiQuestionSignals(query);
	return (
		<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
			{t("keywords.aiScore", { score })} · {reasons.map((reason) => t(`keywords.reason.${reason}`)).join(" · ")}
		</p>
	);
}

function Metrics({ report, loading }: { report?: GscReport; loading: boolean }) {
	return (
		<dl className="grid grid-cols-2 gap-y-5 border-b pb-4 md:grid-cols-4 md:divide-x">
			{(
				[
					["impressions", report ? number(report.totals.impressions) : "—"],
					["clicks", report ? number(report.totals.clicks) : "—"],
					["ctr", report ? percent(report.totals.ctr) : "—"],
					["position", report ? position(report.totals.position) : "—"],
				] as const
			).map(([name, value]) => (
				<div key={name} className="px-4 first:pl-0 md:px-7">
					<dt className="text-sm font-medium">{t(`keywords.${name}`)}</dt>
					<dd className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
						{loading ? <Skeleton className="h-9 w-24" /> : value}
					</dd>
				</div>
			))}
		</dl>
	);
}

function FilterForm({
	status,
	applied,
	report,
	loading,
	exportingDisabled,
	onApply,
	onSettings,
	onExport,
}: {
	status: SearchConsoleStatus;
	applied: SearchConsoleFilters;
	report?: GscReport;
	loading: boolean;
	exportingDisabled: boolean;
	onApply: (filters: SearchConsoleFilters) => void;
	onSettings: () => void;
	onExport: () => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState(applied);
	const [error, setError] = useState(false);
	const [regexOpen, setRegexOpen] = useState(false);
	const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
	function update(patch: Partial<SearchConsoleFilters>) {
		setDraft((previous) => ({ ...previous, ...patch }));
		setError(false);
	}
	function apply(value = draft) {
		const parsed = reportFiltersSchema.safeParse(value);
		setError(!parsed.success);
		if (parsed.success) onApply(parsed.data);
	}
	const setCondition = (index: number, patch: Partial<SearchConsoleFilters["urlConditions"][number]>) =>
		update({ urlConditions: draft.urlConditions.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
	return (
		<form
			className="space-y-4"
			aria-label={t("keywords.active")}
			onSubmit={(e) => {
				e.preventDefault();
				apply();
			}}
		>
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
				<div className="min-w-0 flex-1 space-y-2 sm:min-w-64">
					<p className="text-sm font-medium">{t("keywords.property")}</p>
					<Button
						type="button"
						variant="outline"
						className="h-10 w-full justify-between gap-4 text-left font-normal"
						onClick={onSettings}
						disabled={!status.canManage}
					>
						<span className="truncate" title={status.propertyId ?? ""}>
							{status.propertyId}
						</span>
						<ChevronDown className="size-4" />
					</Button>
				</div>
				<fieldset className="flex min-w-0 flex-wrap items-end gap-2">
					<legend className="mb-2 text-sm font-medium">
						{t("keywords.period")} <span className="font-normal text-muted-foreground">(PT)</span>
					</legend>
					<label className="sr-only" htmlFor={`${id}-from`}>
						{t("keywords.from")}
					</label>
					<Input
						id={`${id}-from`}
						className="h-10 w-36"
						type="date"
						required
						value={draft.startDate}
						onChange={(e) => update({ startDate: e.target.value })}
					/>
					<span className="pb-2 text-muted-foreground" aria-hidden="true">
						–
					</span>
					<label className="sr-only" htmlFor={`${id}-to`}>
						{t("keywords.to")}
					</label>
					<Input
						id={`${id}-to`}
						className="h-10 w-36"
						type="date"
						required
						value={draft.endDate}
						onChange={(e) => update({ endDate: e.target.value })}
					/>
					<Button type="button" variant="ghost" className="h-10" onClick={() => update(defaultSearchConsoleDates())}>
						{t("keywords.last28")}
					</Button>
				</fieldset>
			</div>
			<Metrics report={report} loading={loading} />
			<div className="flex flex-wrap items-center gap-4 lg:gap-6">
				<div className="relative min-w-56 flex-1">
					<Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
					<label className="sr-only" htmlFor={`${id}-keyword`}>
						{t("keywords.keyword")}
					</label>
					<Input
						id={`${id}-keyword`}
						className="h-10 pl-9"
						type="search"
						value={draft.keyword}
						maxLength={256}
						placeholder={t("keywords.keywordPlaceholder")}
						onChange={(e) => update({ keyword: e.target.value })}
					/>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<label htmlFor={`${id}-ai`} className="text-sm font-semibold">
						{t("keywords.aiFilter")}
					</label>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="-ml-2 size-7 text-muted-foreground"
						aria-label={t("keywords.regex")}
						aria-expanded={regexOpen}
						aria-controls={`${id}-regex`}
						onClick={() => setRegexOpen(!regexOpen)}
					>
						<Info className="size-4" />
					</Button>
					<Switch
						id={`${id}-ai`}
						className="h-6 w-10 [&_[data-slot=switch-thumb]]:size-5"
						checked={draft.aiQuestionsOnly}
						onCheckedChange={(checked) => {
							const next = { ...draft, aiQuestionsOnly: checked };
							update({ aiQuestionsOnly: checked });
							apply(next);
						}}
					/>
					<p id={`${id}-ai-help`} className="text-xs leading-5 text-muted-foreground">
						{t("keywords.aiHelp")}
						<br />
						{t("keywords.aiNote")}
					</p>
				</div>
				<Button type="button" className="h-10" disabled={exportingDisabled} onClick={onExport}>
					<Download className="size-4" />
					{t("keywords.export")}
				</Button>
			</div>
			{regexOpen && (
				<div id={`${id}-regex`} className="rounded-lg border p-3 text-xs text-muted-foreground">
					<code className="break-all">{AI_QUESTION_REGEX}</code>
				</div>
			)}
			<section className="space-y-3 rounded-xl border bg-muted/25 p-4 sm:p-5" aria-labelledby={`${id}-url-title`}>
				<div className="flex flex-wrap items-center gap-3">
					<h2 id={`${id}-url-title`} className="font-semibold">
						{t("keywords.urlConditions")}
					</h2>
					<span className="rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground">{t("keywords.and")}</span>
				</div>
				{draft.urlConditions.length === 0 && (
					<p className="py-1 text-sm text-muted-foreground">{t("keywords.noUrlConditions")}</p>
				)}
				{draft.urlConditions.map((condition, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: Conditions are controlled by their ordered form position and contain no local row state.
						key={index}
						className="grid min-w-0 grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[auto_180px_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
					>
						<span className="hidden text-sm sm:block">URL</span>
						<select
							className={`${selectClassName} col-span-2 w-full sm:col-span-1`}
							aria-label={t("keywords.operator", { number: index + 1 })}
							value={condition.operator}
							onChange={(e) =>
								setCondition(index, {
									operator: e.target.value as SearchConsoleFilters["urlConditions"][number]["operator"],
								})
							}
						>
							{operators.map((operator) => (
								<option key={operator} value={operator}>
									{t(`keywords.${operator}`)}
								</option>
							))}
						</select>
						<Input
							className="h-10 min-w-0"
							aria-label={t("keywords.urlValue", { number: index + 1 })}
							value={condition.value}
							maxLength={2048}
							placeholder={t("keywords.urlPlaceholder")}
							required
							onChange={(e) => setCondition(index, { value: e.target.value })}
						/>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="size-10 text-muted-foreground"
							aria-label={t("keywords.remove", { number: index + 1 })}
							onClick={() => update({ urlConditions: draft.urlConditions.filter((_, i) => i !== index) })}
						>
							<X className="size-4" />
						</Button>
					</div>
				))}
				{draft.urlConditions.length > 0 && (
					<p className="text-xs leading-relaxed text-muted-foreground">{t("keywords.urlHelp")}</p>
				)}
				<div className="flex flex-wrap items-center justify-between gap-3 pt-1">
					<Button
						type="button"
						variant="outline"
						className="h-10"
						disabled={draft.urlConditions.length >= 10}
						onClick={() => update({ urlConditions: [...draft.urlConditions, { operator: "contains", value: "" }] })}
					>
						<Plus className="size-4" />
						{t("keywords.add")}
					</Button>
					<div className="ml-auto flex items-center gap-3">
						{dirty && (
							<p role="status" className="hidden text-xs text-muted-foreground md:block">
								{t("keywords.pending")}
							</p>
						)}
						<Button
							type="button"
							variant="outline"
							className="h-10 px-6"
							onClick={() => {
								const clear = { ...applied, keyword: "", aiQuestionsOnly: false, urlConditions: [] };
								setDraft(clear);
								apply(clear);
							}}
						>
							{t("keywords.clear")}
						</Button>
						<Button type="submit" className="h-10 px-7">
							{t("keywords.apply")}
						</Button>
					</div>
				</div>
				{dirty && (
					<p role="status" className="text-xs text-muted-foreground md:hidden">
						{t("keywords.pending")}
					</p>
				)}
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{t("keywords.invalid")}
					</p>
				)}
			</section>
		</form>
	);
}

function AppliedFilters({ filters }: { filters: SearchConsoleFilters }) {
	if (!filters.keyword && !filters.aiQuestionsOnly && !filters.urlConditions.length) return null;
	return (
		<fieldset aria-label={t("keywords.active")} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
			<span>{t("keywords.active")}:</span>
			{filters.keyword && (
				<span className="max-w-full break-all rounded-md border px-2 py-1">
					{t("keywords.keyword")}：{filters.keyword}
				</span>
			)}
			{filters.aiQuestionsOnly && <span className="rounded-md border px-2 py-1">{t("keywords.aiFilter")} ON</span>}
			{filters.urlConditions.map((row, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: Duplicate conditions are allowed; these read-only chips have no local state.
				<span key={index} className="max-w-full break-all rounded-md border px-2 py-1">
					URL {t(`keywords.${row.operator}`)}：{row.value}
				</span>
			))}
		</fieldset>
	);
}

export function KeywordAnalysis({
	brandId,
	search,
	onSearch,
}: {
	brandId: string;
	search: KeywordSearch;
	onSearch: (patch: Partial<KeywordSearch>) => void | Promise<void>;
}) {
	const queryClient = useQueryClient();
	const [settings, setSettings] = useState(search.gsc === "connected");
	const [range] = useState(defaultSearchConsoleDates);
	const statusQuery = useQuery({
		queryKey: ["gsc-status", brandId],
		queryFn: () => getSearchConsoleStatusFn({ data: { brandId } }),
		staleTime: 30_000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const status = statusQuery.data;
	const filters: SearchConsoleFilters = {
		startDate: search.startDate ?? range.startDate,
		endDate: search.endDate ?? range.endDate,
		keyword: search.keyword ?? "",
		aiQuestionsOnly: search.aiQuestionsOnly ?? false,
		urlConditions: parseUrlConditions(search.urlConditions ?? "[]") ?? [],
	};
	const valid = !search.invalidFilters && reportFiltersSchema.safeParse(filters).success;
	const connected = !!status?.configured && status.oauthConnected && !!status.propertyId && !status.needsReauth;
	const reportQuery = useQuery({
		queryKey: ["gsc-report", brandId, status?.propertyId, status?.connectionRevision, filters, GSC_FILTER_VERSION],
		queryFn: () => getSearchConsoleReportFn({ data: { brandId, ...filters } }),
		enabled: connected && valid,
		staleTime: 30 * 60_000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const report = connected && valid && !reportQuery.isError ? reportQuery.data : undefined;
	const sort = search.sort ?? (filters.aiQuestionsOnly ? "aiLikelihood" : "impressions");
	const direction = search.direction ?? "desc";
	const rows = useMemo(() => sortKeywordRows(report?.rows ?? [], sort, direction), [report, sort, direction]);
	const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
	const page = Math.min(search.page ?? 1, pageCount);
	const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	function apply(value: SearchConsoleFilters) {
		void onSearch({
			...value,
			keyword: value.keyword || undefined,
			aiQuestionsOnly: value.aiQuestionsOnly || undefined,
			urlConditions: value.urlConditions.length ? JSON.stringify(value.urlConditions) : undefined,
			page: undefined,
			gsc: undefined,
			invalidFilters: undefined,
			sort: value.aiQuestionsOnly !== filters.aiQuestionsOnly ? undefined : search.sort,
			direction: value.aiQuestionsOnly !== filters.aiQuestionsOnly ? undefined : search.direction,
		});
	}
	async function changed() {
		await queryClient.cancelQueries({ queryKey: ["gsc-report", brandId] });
		queryClient.removeQueries({ queryKey: ["gsc-report", brandId] });
		queryClient.removeQueries({ queryKey: ["gsc-properties", brandId] });
		await queryClient.invalidateQueries({ queryKey: ["gsc-status", brandId] });
		void onSearch({ page: undefined, gsc: undefined });
	}
	function exportCsv() {
		if (!report || reportQuery.isFetching) return;
		const url = URL.createObjectURL(new Blob([keywordCsv(rows)], { type: "text/csv;charset=utf-8" }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `search-keywords-${filters.startDate}-${filters.endDate}.csv`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function changeSort(value: KeywordSort) {
		void onSearch({ sort: value, direction: sort === value && direction === "desc" ? "asc" : "desc", page: undefined });
	}
	return (
		<div className="min-w-0 space-y-4" aria-busy={reportQuery.isFetching}>
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-balance text-2xl font-semibold tracking-tight lg:text-3xl">{t("keywords.title")}</h1>
					<p className="mt-2 text-pretty text-sm text-muted-foreground">{t("keywords.description")}</p>
				</div>
				<div className="flex flex-wrap items-center gap-4">
					{connected && (
						<span className="flex items-center gap-2 text-xs">
							<span className="size-2 rounded-full bg-emerald-500" />
							{t("keywords.connected")}
						</span>
					)}
					{status && (
						<Button variant="outline" className="h-10" onClick={() => setSettings(true)}>
							{t("keywords.settings")}
						</Button>
					)}
				</div>
			</header>
			{statusQuery.isPending ? (
				<div role="status" aria-label={t("keywords.loading")}>
					<Skeleton className="h-40 w-full" />
				</div>
			) : statusQuery.isError || !status ? (
				<SearchConsoleError error={statusQuery.error} onRetry={() => void statusQuery.refetch()} />
			) : (
				<>
					{search.gsc && (
						<p role="status" className="rounded-lg border p-3 text-sm">
							{t(search.gsc === "connected" ? "keywords.oauthSuccess" : "keywords.oauthError")}
						</p>
					)}
					{!connected ? (
						<section className="rounded-xl border px-5 py-14 text-center">
							<Search className="mx-auto mb-5 size-9 text-muted-foreground" />
							<h2 className="text-xl font-semibold">
								{t(
									status.needsReauth
										? "keywords.reconnect"
										: status.oauthConnected
											? "keywords.chooseProperty"
											: "keywords.connectTitle",
								)}
							</h2>
							<p className="mx-auto mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
								{t(
									!status.canManage
										? "keywords.ownerRequired"
										: !status.configured
											? "keywords.notConfigured"
											: status.needsReauth
												? "keywords.reauth"
												: "keywords.connectHelp",
								)}
							</p>
							{status.canManage && (
								<Button className="mt-6" onClick={() => setSettings(true)}>
									{t(status.oauthConnected && !status.needsReauth ? "keywords.chooseProperty" : "keywords.settings")}
								</Button>
							)}
						</section>
					) : (
						<>
							<FilterForm
								key={`${status.connectionRevision}:${JSON.stringify(filters)}`}
								status={status}
								applied={filters}
								report={report}
								loading={reportQuery.isPending && valid}
								exportingDisabled={!report || reportQuery.isFetching}
								onApply={apply}
								onSettings={() => setSettings(true)}
								onExport={exportCsv}
							/>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<AppliedFilters filters={filters} />
								{filters.aiQuestionsOnly && (
									<Button
										variant="outline"
										size="sm"
										aria-pressed={sort === "aiLikelihood"}
										onClick={() => changeSort("aiLikelihood")}
									>
										{t("keywords.aiSort")}
										{sort === "aiLikelihood" &&
											(direction === "desc" ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />)}
									</Button>
								)}
							</div>
							{!valid && (
								<div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
									{t("keywords.invalid")}
									<Button
										variant="outline"
										size="sm"
										className="ml-3 text-foreground"
										onClick={() => apply({ ...range, keyword: "", aiQuestionsOnly: false, urlConditions: [] })}
									>
										{t("keywords.clear")}
									</Button>
								</div>
							)}
							{reportQuery.isError && (
								<SearchConsoleError
									error={reportQuery.error}
									onRetry={() => {
										void statusQuery.refetch();
										void reportQuery.refetch();
									}}
								/>
							)}
							{reportQuery.isFetching && valid && (
								<p role="status" className="text-xs text-muted-foreground">
									{t(report ? "keywords.updating" : "keywords.loading")}
								</p>
							)}
							{report?.truncated && (
								<p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
									{t("keywords.truncated")}
								</p>
							)}
							{report && (
								<>
									<div className="overflow-hidden rounded-xl border">
										<div className="overflow-x-auto">
											<table className="w-full min-w-[700px] text-sm tabular-nums">
												<thead className="bg-muted/40 text-muted-foreground">
													<tr>
														{(["query", "impressions", "clicks", "ctr", "position"] as const).map((column) => (
															<th
																key={column}
																scope="col"
																aria-sort={
																	sort === column ? (direction === "asc" ? "ascending" : "descending") : "none"
																}
																className={`px-5 py-3 text-left font-medium ${column === "query" ? "w-[46%]" : ""}`}
															>
																<button
																	type="button"
																	className={`flex w-full items-center gap-1 rounded-sm outline-offset-4 hover:text-foreground focus-visible:outline-2 ${column === "query" ? "" : "justify-end"}`}
																	onClick={() => changeSort(column)}
																>
																	{t(column === "query" ? "keywords.keyword" : `keywords.${column}`)}
																	{sort === column &&
																		(direction === "desc" ? (
																			<ArrowDown className="size-4" />
																		) : (
																			<ArrowUp className="size-4" />
																		))}
																</button>
															</th>
														))}
													</tr>
												</thead>
												<tbody className="divide-y">
													{visibleRows.map((row) => (
														<tr key={row.query} className="hover:bg-muted/20">
															<th scope="row" className="max-w-xl break-words px-5 py-3 text-left font-normal">
																{row.query}
																{filters.aiQuestionsOnly && <AiQuestionReasons query={row.query} />}
															</th>
															<td className="px-5 py-3 text-right">{number(row.impressions)}</td>
															<td className="px-5 py-3 text-right">{number(row.clicks)}</td>
															<td className="px-5 py-3 text-right">{percent(row.ctr)}</td>
															<td className="px-5 py-3 text-right">{position(row.position)}</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
										{!rows.length && (
											<div className="space-y-2 p-10 text-center">
												<p className="font-medium">{t("keywords.noData")}</p>
												<p className="text-sm text-muted-foreground">{t("keywords.noDataHelp")}</p>
											</div>
										)}
									</div>
									<div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
										<p>
											{t("keywords.count", {
												total: number(rows.length),
												from: rows.length ? (page - 1) * PAGE_SIZE + 1 : 0,
												to: Math.min(page * PAGE_SIZE, rows.length),
											})}
										</p>
										<p>
											{t("keywords.period")}：{filters.startDate} – {filters.endDate} (PT)
										</p>
										<nav aria-label={t("keywords.title")} className="flex items-center gap-2">
											<Button
												variant="outline"
												size="icon"
												aria-label={t("keywords.previous")}
												disabled={page <= 1}
												onClick={() => void onSearch({ page: page - 1 })}
											>
												<ChevronLeft className="size-4" />
											</Button>
											{Array.from(
												{ length: Math.min(pageCount, 5) },
												(_, index) => Math.min(Math.max(1, page - 2), Math.max(1, pageCount - 4)) + index,
											).map((value) => (
												<Button
													key={value}
													variant={value === page ? "secondary" : "outline"}
													size="icon"
													aria-current={value === page ? "page" : undefined}
													aria-label={t("keywords.page", { number: value })}
													onClick={() => void onSearch({ page: value })}
												>
													{value}
												</Button>
											))}
											{pageCount > 5 && page < pageCount - 2 && <span>… {pageCount}</span>}
											<Button
												variant="outline"
												size="icon"
												aria-label={t("keywords.next")}
												disabled={page >= pageCount}
												onClick={() => void onSearch({ page: page + 1 })}
											>
												<ChevronRight className="size-4" />
											</Button>
										</nav>
									</div>
								</>
							)}
							<footer className="space-y-2 text-pretty text-xs leading-relaxed text-muted-foreground">
								<p>{t("keywords.dateHelp")}</p>
								<p>{t("keywords.subset")}</p>
								{report && (
									<p>
										{t("keywords.fetched")}：
										{new Intl.DateTimeFormat(UI_LOCALE, {
											dateStyle: "short",
											timeStyle: "short",
											timeZone: "Asia/Tokyo",
										}).format(new Date(report.fetchedAt))}{" "}
										JST
									</p>
								)}
							</footer>
						</>
					)}
					{settings && (
						<SearchConsoleSettings
							brandId={brandId}
							status={status}
							onClose={() => setSettings(false)}
							onChanged={changed}
						/>
					)}
				</>
			)}
		</div>
	);
}
