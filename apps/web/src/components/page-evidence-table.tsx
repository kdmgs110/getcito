import { IconChevronDown, IconChevronRight, IconExternalLink, IconSelector } from "@tabler/icons-react";
import { safeEvidenceUrl } from "@workspace/lib/measurement";
import type { PageEvidenceAggregate, PageEvidenceRow } from "@workspace/lib/page-evidence";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Fragment, useMemo, useState } from "react";
import { createTranslator } from "@/i18n";
import { formatDateTime } from "@/lib/app-locale";
import { InfoTip } from "./fanout-sections";
import { ListPagination, usePagedList } from "./list-pagination";

const pt = createTranslator({
	title: { ja: "ページ・ドメイン別の出現と引用", en: "Search appearances and answer citations" },
	pages: { ja: "ページ別", en: "Pages" },
	domains: { ja: "ドメイン別", en: "Domains" },
	all: { ja: "すべて", en: "All" },
	cited: { ja: "引用あり", en: "Cited" },
	search_only: { ja: "検索結果のみ", en: "Search results only" },
	page: { ja: "ページ / URL", en: "Page / URL" },
	domain: { ja: "ドメイン", en: "Domain" },
	search: { ja: "AI検索に出た回答数", en: "Answers with a search appearance" },
	citations: { ja: "最終回答で引用された回答数", en: "Answers citing the page" },
	transition: { ja: "検索→引用", en: "Search → citation" },
	searchHelp: {
		ja: "保存された検索結果にURLを含む回答数です。同じ回答内の重複は1回答。延べ件数は重複を含む検索結果の取得項目数です。",
		en: "Distinct answers containing this URL in captured search results. Occurrences count returned entries, including duplicates.",
	},
	citeHelp: {
		ja: "最終回答の参照元にURLを含む回答数です。回答内の引用マーカー数ではありません。",
		en: "Distinct answers containing this URL in final sources, not the number of citation markers.",
	},
	transitionHelp: {
		ja: "検索結果と参照元の両方を観測できた同じ回答だけで計算します。因果関係や個別検索語への帰属は示しません。",
		en: "Calculated only across the same answers with both search and source coverage. This does not establish causation or query attribution.",
	},
	domainHelp: {
		ja: "wwwのみ同一視し、別サブドメインは分けます。同じ回答で複数ページが出てもドメインの回答数は1です。ページの回答数の合計とは一致しません。",
		en: "Only www is combined. Multiple pages in one answer count as one domain appearance, so page answer totals may differ.",
	},
	unknown: { ja: "未提供", en: "Not provided" },
	answers: { ja: "回答", en: "answers" },
	occurrence: { ja: "延べ{count}件（重複含む）", en: "{count} occurrences (including duplicates)" },
	note: {
		ja: "同じ回答内の同一URLは1回答として集計。未提供は0件にしません。参考検索は集計に含めません。",
		en: "URLs are counted once per answer. Unavailable data is not zero. Reference searches are excluded.",
	},
	empty: { ja: "この条件に一致するページはありません。", en: "No pages match these filters." },
	noData: {
		ja: "検索結果・参照元のページ情報は取得元から提供されていません。",
		en: "The provider did not expose search-result or source pages.",
	},
	history: { ja: "根拠となる回答", en: "Evidence answers" },
	showHistory: { ja: "根拠となる回答を表示", en: "Show evidence answers" },
	answer: { ja: "LLMの回答を見る", en: "View LLM answer" },
	present: { ja: "検索出現あり", en: "In search results" },
	absent: { ja: "検索出現なし", en: "Not in search results" },
	citedYes: { ja: "引用あり", en: "Cited" },
	citedNo: { ja: "引用なし", en: "Not cited" },
	external: { ja: "別タブで開く", en: "Open in a new tab" },
	filterHelp: {
		ja: "検索結果のみ：参照元を確認できた回答で未引用のもの。参照元不明の回答は含めません。",
		en: "Search results only includes uncited pages where source coverage is known; answers with unknown source coverage are excluded.",
	},
	searchCoverage: { ja: "検索結果取得 {known}/{total}回答", en: "Search coverage {known}/{total} answers" },
	citationCoverage: { ja: "参照元取得 {known}/{total}回答", en: "Source coverage {known}/{total} answers" },
});

type History = PageEvidenceRow["history"][number];
type Filter = "all" | "cited" | "search_only";
type Sort = "searchAnswers" | "citationAnswers" | "transition";

export function PageEvidenceTable({
	pages,
	domains,
	onAnswer,
}: {
	pages: PageEvidenceAggregate;
	domains: PageEvidenceAggregate;
	onAnswer: (answer: History) => void;
}) {
	const [groupBy, setGroupBy] = useState<"page" | "domain">("page");
	const [filter, setFilter] = useState<Filter>("all");
	const [sort, setSort] = useState<{ key: Sort; descending: boolean }>({ key: "citationAnswers", descending: true });
	const [expanded, setExpanded] = useState<string | null>(null);
	const [domainKey, setDomainKey] = useState<string | null>(null);
	const aggregate = groupBy === "page" ? pages : domains;
	const rows = useMemo(
		() =>
			aggregate.rows
				.filter(
					(row) =>
						(!domainKey || groupBy !== "page" || row.domain === domainKey) &&
						(filter === "all" ||
							(filter === "cited" ? row.citationAnswers > 0 : row.citationAnswers === 0 && row.searchOnlyAnswers > 0)),
				)
				.sort((a, b) => {
					const metric = (row: PageEvidenceRow) =>
						sort.key === "transition"
							? row.transitionSearchAnswers
								? row.transitionAnswers / row.transitionSearchAnswers
								: -1
							: row[sort.key];
					return (
						(metric(a) - metric(b)) * (sort.descending ? -1 : 1) ||
						b.citationAnswers - a.citationAnswers ||
						b.searchAnswers - a.searchAnswers ||
						a.key.localeCompare(b.key)
					);
				}),
		[aggregate, filter, sort, domainKey, groupBy],
	);
	const paged = usePagedList(rows, 10);
	const changeSort = (key: Sort) => {
		setSort((previous) => ({ key, descending: previous.key === key ? !previous.descending : true }));
		paged.setPage(0);
	};
	const metric = (count: number, denominator: number) =>
		denominator ? `${count} / ${denominator}${pt("answers")}` : pt("unknown");
	return (
		<Card className="gap-3" data-testid="page-evidence-table">
			<CardHeader className="gap-3 pb-0">
				<div className="flex flex-wrap items-center gap-3">
					<CardTitle className="text-base">{pt("title")}</CardTitle>
					<fieldset className="inline-flex rounded-md border bg-muted/30 p-0.5" aria-label={pt("title")}>
						{(["page", "domain"] as const).map((value) => (
							<button
								type="button"
								key={value}
								aria-pressed={groupBy === value}
								className={`rounded px-3 py-1 text-xs ${groupBy === value ? "bg-background font-medium text-blue-600 shadow-sm" : "text-muted-foreground"}`}
								onClick={() => {
									setGroupBy(value);
									setDomainKey(null);
									setExpanded(null);
									paged.setPage(0);
								}}
							>
								{pt(value === "page" ? "pages" : "domains")}
							</button>
						))}
					</fieldset>
					<fieldset className="inline-flex rounded-md border bg-muted/30 p-0.5" aria-label={pt("filterHelp")}>
						{(["all", "cited", "search_only"] as const).map((value) => (
							<button
								type="button"
								key={value}
								aria-pressed={filter === value}
								className={`rounded px-3 py-1 text-xs ${filter === value ? "bg-background font-medium text-blue-600 shadow-sm" : "text-muted-foreground"}`}
								onClick={() => {
									setFilter(value);
									setExpanded(null);
									paged.setPage(0);
								}}
							>
								{pt(value)}
							</button>
						))}
					</fieldset>
					<InfoTip>{pt("filterHelp")}</InfoTip>
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
					<span>{pt("searchCoverage", { known: aggregate.searchAnswers, total: aggregate.totalAnswers })}</span>
					<span>{pt("citationCoverage", { known: aggregate.citationAnswers, total: aggregate.totalAnswers })}</span>
					{domainKey && (
						<button
							type="button"
							className="text-blue-600 underline"
							onClick={() => {
								setDomainKey(null);
								paged.setPage(0);
							}}
						>
							{domainKey} ×
						</button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-2">
				<div className="overflow-x-auto rounded-md border">
					<table className="w-full min-w-[760px] table-fixed text-left text-sm">
						<thead className="bg-muted/40 text-xs">
							<tr className="border-b">
								<th className="w-[43%] px-3 py-2 font-medium">
									{pt(groupBy === "page" ? "page" : "domain")}
									{groupBy === "domain" && <InfoTip>{pt("domainHelp")}</InfoTip>}
								</th>
								{(
									[
										["searchAnswers", "search", "searchHelp"],
										["citationAnswers", "citations", "citeHelp"],
										["transition", "transition", "transitionHelp"],
									] as const
								).map(([key, label, help]) => (
									<th
										key={key}
										className="px-3 py-2 font-medium border-l"
										aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}
									>
										<div className="flex items-center gap-1">
											<button
												className="inline-flex items-center gap-1 text-left"
												type="button"
												onClick={() => changeSort(key)}
											>
												{pt(label)}
												<IconSelector size={12} />
											</button>
											<InfoTip>{pt(help)}</InfoTip>
										</div>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{paged.pageItems.map((row) => {
								const url = safeEvidenceUrl(row.url);
								const open = expanded === row.key;
								const history =
									filter === "search_only"
										? row.history.filter((answer) => answer.searchPresent && answer.cited === false)
										: row.history;
								return (
									<Fragment key={row.key}>
										<tr className="border-b last:border-b-0 align-top hover:bg-muted/15">
											<td className="px-3 py-2">
												<div className="flex items-start gap-2">
													<button
														type="button"
														className="mt-0.5 shrink-0 rounded focus-visible:outline-2"
														aria-expanded={open}
														aria-label={`${pt("showHistory")}: ${row.title || row.displayDomain}`}
														onClick={() => setExpanded(open ? null : row.key)}
													>
														{open ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
													</button>
													<div className="min-w-0">
														<button
															type="button"
															onClick={() => setExpanded(open ? null : row.key)}
															className="block break-words text-left font-medium"
														>
															{groupBy === "domain" ? row.displayDomain : row.title || row.displayDomain}
														</button>
														{groupBy === "page" && url && (
															<a
																href={url}
																target="_blank"
																rel="noopener noreferrer"
																className="mt-0.5 inline-flex max-w-full items-start gap-1 break-all text-xs text-blue-600 hover:underline"
															>
																<span>{url}</span>
																<IconExternalLink size={13} className="mt-0.5 shrink-0" aria-label={pt("external")} />
															</a>
														)}
														{groupBy === "domain" && (
															<button
																type="button"
																className="mt-1 text-xs text-blue-600 hover:underline"
																onClick={() => {
																	setGroupBy("page");
																	setDomainKey(row.domain);
																	setExpanded(null);
																	paged.setPage(0);
																}}
															>
																{pt("pages")}
															</button>
														)}
													</div>
												</div>
											</td>
											<td className="border-l px-3 py-2 tabular-nums">
												<span>{metric(row.searchAnswers, aggregate.searchAnswers)}</span>
												{aggregate.searchAnswers > 0 && (
													<span className="mt-0.5 block text-xs text-muted-foreground">
														{pt("occurrence", { count: row.searchOccurrences })}
													</span>
												)}
											</td>
											<td className="border-l px-3 py-2 tabular-nums">
												{metric(row.citationAnswers, aggregate.citationAnswers)}
											</td>
											<td className="border-l px-3 py-2 tabular-nums">
												{row.transitionSearchAnswers ? (
													<>
														<span>
															{row.transitionAnswers} / {row.transitionSearchAnswers}
															{pt("answers")}
														</span>
														<span className="block text-xs text-muted-foreground">
															{((100 * row.transitionAnswers) / row.transitionSearchAnswers).toFixed(1)}%
														</span>
													</>
												) : (
													"—"
												)}
											</td>
										</tr>
										{open && (
											<tr className="border-b bg-muted/15">
												<td colSpan={4} className="px-6 py-3">
													<p className="mb-2 text-xs font-medium">{pt("history")}</p>
													<ul className="space-y-2">
														{history.map((answer) => (
															<li key={answer.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
																<span>{formatDateTime(answer.createdAt, { timeZoneName: "short" })}</span>
																<span className="text-muted-foreground">{answer.provider}</span>
																<span>
																	{answer.searchPresent === null
																		? pt("unknown")
																		: pt(answer.searchPresent ? "present" : "absent")}
																	{answer.searchPresent &&
																		` · ${pt("occurrence", { count: answer.searchOccurrences })}`}
																</span>
																<span>
																	{answer.cited === null ? pt("unknown") : pt(answer.cited ? "citedYes" : "citedNo")}
																</span>
																<button
																	type="button"
																	onClick={() => onAnswer(answer)}
																	className="text-blue-600 underline underline-offset-2"
																>
																	{pt("answer")}
																</button>
															</li>
														))}
													</ul>
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
					{!rows.length && (
						<p className="p-8 text-center text-sm text-muted-foreground">
							{aggregate.searchAnswers || aggregate.citationAnswers ? pt("empty") : pt("noData")}
						</p>
					)}
				</div>
				<p className="text-xs leading-relaxed text-muted-foreground">{pt("note")}</p>
				<ListPagination {...paged} onPageChange={paged.setPage} />
			</CardContent>
		</Card>
	);
}
