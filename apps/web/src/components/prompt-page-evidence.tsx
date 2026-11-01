import { IconExternalLink } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { safeEvidenceUrl } from "@workspace/lib/measurement";
import type { PageEvidenceHistory } from "@workspace/lib/page-evidence";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { usePromptPageEvidence } from "@/hooks/use-prompt-page-evidence";
import { createTranslator } from "@/i18n";
import { APP_TIMEZONE, formatDateTime } from "@/lib/app-locale";
import type { LookbackPeriod } from "@/lib/chart-utils";
import { getPromptMeasurementDetailFn } from "@/server/prompt-measurements";
import { PageEvidenceTable } from "./page-evidence-table";
import { PromptMeasurementCard, type PromptMeasurementScope } from "./prompt-measurements";

const et = createTranslator({
	target: { ja: "計測対象", en: "Measurement target" },
	scope: { ja: "集計条件", en: "Locale" },
	mode: { ja: "集計範囲", en: "Answer scope" },
	period: { ja: "期間内の回答", en: "Answers in this period" },
	exact: { ja: "1回答の詳細", en: "Selected answer" },
	clear: { ja: "回答の選択を解除", en: "Clear answer selection" },
	searchCoverage: {
		ja: "対象{total}回答 ／ 検索結果取得 {search}/{total} ／ 参照元取得 {citations}/{total}",
		en: "{total} answers / Search coverage {search}/{total} / Source coverage {citations}/{total}",
	},
	fanout: { ja: "プロンプト別の検索展開", en: "Prompt query fan-out" },
	words: { ja: "検索語", en: "Query words" },
	distinct: { ja: "重複を除いた検索クエリ：{count}件。", en: "{count} distinct search queries." },
	noRelation: {
		ja: "検索語とAI取得URLの対応は未提供です。回答全体のページ情報と回数は下に表示します。",
		en: "The provider did not expose query-to-URL relationships. Answer-wide page evidence and counts are shown below.",
	},
	search_result: { ja: "検索結果", en: "Search result" },
	visited: { ja: "閲覧", en: "Visited" },
	citation: { ja: "引用", en: "Citation" },
	unknown: { ja: "役割未提供", en: "Role not provided" },
	relationship: { ja: "取得元にクエリとURLの対応情報あり", en: "Provider-reported query-to-URL relationship" },
	answers: { ja: "この検索語を含む回答", en: "Answers containing this search query" },
	answer: { ja: "LLMの回答を見る", en: "View LLM answer" },
	observed: { ja: "検索語取得済み", en: "Search query captured" },
	loading: { ja: "検索結果と引用情報を読み込んでいます…", en: "Loading search and citation evidence…" },
	error: { ja: "検索結果と引用情報を読み込めませんでした。", en: "Could not load search and citation evidence." },
	retry: { ja: "再試行", en: "Retry" },
	noQueries: {
		ja: "観測された検索語はありません。内部検索がなかったことを示すものではありません。",
		en: "No search queries were exposed. This does not establish that no internal search occurred.",
	},
	noAnswers: {
		ja: "選択した期間・条件の成功回答はありません。",
		en: "No successful answers for this period and scope.",
	},
	exactMissing: {
		ja: "選択した回答はこの条件では確認できません。期間・言語を変更するか、回答の選択を解除してください。",
		en: "The selected answer is outside these filters. Change the period or language, or clear the selection.",
	},
	noTargets: { ja: "この期間の計測対象がありません。", en: "No measurement targets in this period." },
});

export interface PageEvidenceSelection {
	targetKey?: string;
	scopeKey?: string;
	attemptId?: string;
	runId?: string;
	model?: string;
}

export function PromptPageEvidence({
	brandId,
	promptId,
	lookback,
	language,
	selection,
	onSelection,
	onAnswer,
}: {
	brandId: string;
	promptId: string;
	lookback: LookbackPeriod;
	language: string;
	selection: PageEvidenceSelection;
	onSelection: (selection: PageEvidenceSelection) => void;
	onAnswer: (answer: Pick<PageEvidenceHistory, "attemptId" | "runId" | "targetKey">) => void;
}) {
	const result = usePromptPageEvidence(brandId, { promptId, lookback, language, ...selection });
	const data = result.data;
	if (!data)
		return (
			<div role={result.isError ? "alert" : "status"} className="py-10 text-center text-sm text-muted-foreground">
				<p>{et(result.isError ? "error" : "loading")}</p>
				{result.isError && (
					<button type="button" className="mt-3 text-blue-600 underline" onClick={() => result.refetch()}>
						{et("retry")}
					</button>
				)}
			</div>
		);
	const exact = !!(selection.attemptId || selection.runId);
	const words = [...new Set(data.queries.flatMap(({ query }) => query.toLowerCase().split(/\s+/).filter(Boolean)))];
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-end gap-x-6 gap-y-3">
				<label className="flex flex-wrap items-center gap-3 text-sm">
					<span className="font-medium">{et("target")}</span>
					<select
						aria-label={et("target")}
						value={data.selectedTargetKey ?? ""}
						className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
						onChange={(event) =>
							onSelection({
								targetKey: event.target.value,
								scopeKey: undefined,
								attemptId: undefined,
								runId: undefined,
							})
						}
					>
						{!data.targets.length && !data.selectedTargetKey && <option value="">{et("noTargets")}</option>}
						{data.selectedTargetKey && !data.targets.some((target) => target.key === data.selectedTargetKey) && (
							<option value={data.selectedTargetKey}>{data.selectedTargetKey}</option>
						)}
						{data.targets.map((target) => (
							<option key={target.key} value={target.key} title={target.key}>
								{target.label} / {target.provider}
								{target.key.startsWith("legacy:")
									? " / legacy"
									: target.key.split(":").length > 2
										? ` / ${target.key.split(":").slice(2).join(":")}`
										: ""}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-wrap items-center gap-3 text-sm">
					<span className="font-medium">{et("scope")}</span>
					<select
						aria-label={et("scope")}
						value={data.selectedScopeKey ?? ""}
						className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
						onChange={(event) =>
							onSelection({
								...selection,
								targetKey: data.selectedTargetKey ?? undefined,
								scopeKey: event.target.value,
								attemptId: undefined,
								runId: undefined,
							})
						}
					>
						{data.selectedScopeKey && !data.scopes.some((scope) => scope.key === data.selectedScopeKey) && (
							<option value={data.selectedScopeKey}>{data.selectedScopeKey}</option>
						)}
						{data.scopes.map((scope) => (
							<option key={scope.key} value={scope.key}>
								{scope.label}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap items-center gap-3 text-sm">
					<span className="font-medium">{et("mode")}</span>
					<span className="rounded-md border px-3 py-2">{et(exact ? "exact" : "period")}</span>
					{exact && (
						<button
							type="button"
							className="text-xs text-blue-600 underline"
							onClick={() => onSelection({ ...selection, attemptId: undefined, runId: undefined })}
						>
							{et("clear")}
						</button>
					)}
				</div>
			</div>
			<p className="text-xs text-muted-foreground" aria-live="polite">
				{et("searchCoverage", {
					total: data.pages.totalAnswers,
					search: data.pages.searchAnswers,
					citations: data.pages.citationAnswers,
				})}
			</p>
			{!data.pages.totalAnswers && (
				<p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
					{et(exact ? "exactMissing" : "noAnswers")}
				</p>
			)}
			<Tabs defaultValue="fanout" className="gap-3">
				<TabsList>
					<TabsTrigger value="fanout">{et("fanout")}</TabsTrigger>
					<TabsTrigger value="words">{et("words")}</TabsTrigger>
				</TabsList>
				<TabsContent value="fanout" className="space-y-4">
					<Card className="gap-3">
						<CardHeader className="pb-0">
							<CardTitle className="text-base">{et("fanout")}</CardTitle>
							<CardDescription>{et("distinct", { count: data.queries.length })}</CardDescription>
						</CardHeader>
						<CardContent>
							{data.queries.length ? (
								<div className="overflow-hidden rounded-md border">
									{data.queries.map((item) => (
										<details key={item.query} className="group border-b last:border-b-0 text-sm">
											<summary className="cursor-pointer break-words bg-muted/20 px-4 py-3">
												<span>{item.query}</span>
												<span className="ml-3 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
													{et("observed")}
												</span>
											</summary>
											<div className="space-y-3 border-t px-5 py-3">
												{item.relations.length ? (
													<div className="space-y-2">
														<p className="text-xs text-muted-foreground">{et("relationship")}</p>
														{item.relations.map((relation) => {
															const url = safeEvidenceUrl(relation.url);
															return url ? (
																<a
																	key={`${url}:${relation.role}:${relation.sourceField}`}
																	href={url}
																	target="_blank"
																	rel="noopener noreferrer"
																	className="block rounded-md border p-3"
																>
																	<span className="flex items-center gap-1 font-medium">
																		{relation.title || new URL(url).hostname}
																		<IconExternalLink size={14} />
																	</span>
																	<span className="mt-1 block break-all text-xs text-blue-600">{url}</span>
																	<span className="mt-1 block text-xs text-muted-foreground">
																		{et(relation.role)} · {relation.sourceField}
																	</span>
																</a>
															) : null;
														})}
													</div>
												) : (
													<p className="text-xs leading-relaxed text-muted-foreground">{et("noRelation")}</p>
												)}
												<p className="text-xs font-medium">{et("answers")}</p>
												<ul className="space-y-2">
													{item.answers.map((answer) => (
														<li key={answer.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
															<span>{formatDateTime(answer.createdAt, { timeZoneName: "short" })}</span>
															<span className="text-muted-foreground">{answer.provider}</span>
															<button
																type="button"
																className="text-blue-600 underline underline-offset-2"
																onClick={() => onAnswer(answer)}
															>
																{et("answer")}
															</button>
														</li>
													))}
												</ul>
											</div>
										</details>
									))}
								</div>
							) : (
								<p className="py-4 text-sm text-muted-foreground">{et("noQueries")}</p>
							)}
						</CardContent>
					</Card>
					<PageEvidenceTable pages={data.pages} domains={data.domains} onAnswer={onAnswer} />
				</TabsContent>
				<TabsContent value="words">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">{et("words")}</CardTitle>
						</CardHeader>
						<CardContent>
							{words.length ? (
								<div className="flex flex-wrap gap-2">
									{words.map((word) => (
										<span key={word} className="rounded-md border px-2 py-1 text-sm">
											{word}
										</span>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">{et("noQueries")}</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}

/** Exact run selection is resolved by the authorized detail API, not the latest comparison result. */
export function PromptPageEvidenceAnswer({
	scope,
	selection,
	onClear,
	onQueries,
}: {
	scope: PromptMeasurementScope;
	selection: PageEvidenceSelection;
	onClear: () => void;
	onQueries: (answer: Pick<PageEvidenceHistory, "attemptId" | "runId" | "targetKey">) => void;
}) {
	const result = useQuery({
		queryKey: ["prompt-page-evidence-answer", scope, selection.attemptId, selection.runId, selection.targetKey],
		queryFn: () =>
			getPromptMeasurementDetailFn({
				data: {
					...scope,
					attemptId: selection.attemptId,
					runId: selection.runId,
					targetKey: selection.targetKey,
					timezone: APP_TIMEZONE,
				},
			}),
		staleTime: 30000,
	});
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm">
				<span>{et("exact")}</span>
				<button type="button" className="text-xs text-blue-600 underline" onClick={onClear}>
					{et("clear")}
				</button>
			</div>
			{result.isLoading ? (
				<p role="status">{et("loading")}</p>
			) : result.isError || !result.data ? (
				<p role="alert" className="text-sm text-red-700">
					{et("exactMissing")}
				</p>
			) : (
				<PromptMeasurementCard
					label={`${result.data.model === "chatgpt" ? "ChatGPT Web" : result.data.model} / ${result.data.provider}`}
					record={result.data}
					configured
					onQueries={onQueries}
				/>
			)}
		</div>
	);
}
