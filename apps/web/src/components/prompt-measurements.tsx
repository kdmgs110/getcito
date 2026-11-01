import { useQuery } from "@tanstack/react-query";
import { measurementTargetLabel, safeEvidenceUrl } from "@workspace/lib/measurement";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { createTranslator } from "@/i18n";
import { APP_TIMEZONE, formatDateTime } from "@/lib/app-locale";
import { observedQueries, type PromptMeasurementRecord, type PromptMeasurementTarget } from "@/lib/prompt-measurements";
import { getPromptMeasurementDetailFn, getPromptMeasurementsFn } from "@/server/prompt-measurements";
import { PromptRunContext } from "./prompt-run-context";

const mt = createTranslator({
	loading: { ja: "計測結果を読み込んでいます…", en: "Loading measurements…" },
	error: {
		ja: "計測結果を読み込めませんでした。再度お試しください。",
		en: "Could not load measurements. Please try again.",
	},
	scopeError: {
		ja: "この期間・言語では選択した回答を確認できません。期間や言語を変更するか、回答の選択を解除してください。",
		en: "The selected answer is outside this period or language. Change the filters or clear the answer selection.",
	},
	compareInfo: {
		ja: "同じ質問の回答を計測対象ごとに比較します。日時や取得条件が異なる回答は同時計測ではありません。",
		en: "Compare answers to the same question by measurement target. Different dates or request conditions are not a paired measurement.",
	},
	target: { ja: "計測対象", en: "Measurement target" },
	answerSelection: { ja: "回答を選択", en: "Select answer" },
	historical: { ja: "過去の計測", en: "Historical target" },
	legacy: { ja: "過去実行・要求版未記録", en: "Legacy run; requested version not recorded" },
	unconfigured: {
		ja: "このサービスは計測対象に設定されていません。",
		en: "This service is not configured for measurement.",
	},
	unmeasured: { ja: "選択した期間・言語の計測結果はありません。", en: "No measurements for this period and language." },
	notMeasured: { ja: "未計測", en: "Not measured" },
	queued: { ja: "取得待ち", en: "Queued" },
	running: { ja: "取得中", en: "Running" },
	failed: { ja: "取得失敗", en: "Failed" },
	succeeded: { ja: "取得済み", en: "Retrieved" },
	notShown: { ja: "AI Overview非表示", en: "AI Overview not shown" },
	unknown: { ja: "表示状態不明", en: "Answer availability unknown" },
	failedInfo: {
		ja: "この対象の取得に失敗しました。他の対象の成功結果とは分けて表示しています。",
		en: "This target failed. Successful results from other targets are displayed independently.",
	},
	notShownInfo: {
		ja: "この検索ではAI Overviewが表示されませんでした。取得失敗とは区別しています。",
		en: "No AI Overview was shown for this search. This is different from an acquisition failure.",
	},
	unknownInfo: {
		ja: "取得元の情報から回答の表示状態を確認できません。",
		en: "The provider data does not establish whether an answer was shown.",
	},
	provider: { ja: "取得元", en: "Provider" },
	version: { ja: "バージョン", en: "Version" },
	time: { ja: "評価日時", en: "Evaluated at" },
	notProvided: { ja: "取得元から未提供", en: "Not exposed by provider" },
	answer: { ja: "LLMの回答", en: "LLM answer" },
	sources: { ja: "回答全体の参照ページ", en: "Sources for the whole answer" },
	noSources: { ja: "回答全体の参照ページは取得されていません。", en: "No answer-wide source pages were captured." },
	queries: { ja: "ウェブ検索クエリ", en: "Web search queries" },
	noQueryClaim: { ja: "検索なしを意味するものではありません。", en: "This does not mean that no search occurred." },
	noSearch: { ja: "ウェブ検索未使用", en: "Web search not used" },
	viewQueries: { ja: "ウェブ検索クエリで確認 →", en: "View web search queries →" },
	raw: { ja: "元の出力", en: "Raw output" },
	submitted: { ja: "取得元へ実際に送信した入力", en: "Input actually sent to the provider" },
	exactAnswer: { ja: "対象の回答", en: "Selected answer" },
	clear: { ja: "回答の選択を解除", en: "Clear answer selection" },
	queryFanout: { ja: "プロンプト別の検索展開", en: "Prompt query fan-out" },
	words: { ja: "検索語", en: "Query words" },
	evidence: { ja: "参照ページ", en: "Source pages" },
	noRelations: {
		ja: "このクエリと参照ページの対応は、取得元から提供されていません。回答全体の参照ページは下に表示します。",
		en: "The provider did not expose pages associated with this query. Answer-wide sources are shown separately below.",
	},
	relationEvidence: { ja: "取得元にクエリとURLの対応情報あり", en: "Provider-reported query-to-URL relationship" },
	field: { ja: "根拠フィールド", en: "Evidence field" },
	search_result: { ja: "検索結果", en: "Search result" },
	visited: { ja: "閲覧", en: "Visited" },
	citation: { ja: "引用", en: "Citation" },
	unknownRole: { ja: "役割未提供", en: "Role not exposed" },
	wordsScope: { ja: "選択した回答で観測された検索語", en: "Words observed in the selected answer's search queries" },
	noWords: {
		ja: "観測された検索語はありません。内部検索がなかったことを示すものではありません。",
		en: "No query words were observed. This does not establish that no internal searches occurred.",
	},
});

export interface PromptMeasurementScope {
	brandId: string;
	promptId: string;
	lookback: string;
	language: string;
}

export interface PromptMeasurementSelection {
	attemptId?: string;
	runId?: string;
	targetKey?: string;
}

function measurementDetailInput(scope: PromptMeasurementScope, record: PromptMeasurementRecord) {
	return {
		...scope,
		timezone: APP_TIMEZONE,
		attemptId: record.attemptId ?? undefined,
		runId: record.runId ?? undefined,
		targetKey: record.targetKey,
	};
}

function measurementState(record: PromptMeasurementRecord | undefined) {
	if (!record) return "notMeasured";
	if (record.status !== "succeeded") return record.status;
	if (record.evidence.answerStatus === "not_shown") return "notShown";
	if (record.evidence.answerStatus === "unknown") return "unknown";
	return "succeeded";
}

export function MeasurementSources({ citations }: { citations: PromptMeasurementRecord["citations"] }) {
	const safe = citations.flatMap((item) => {
		const url = safeEvidenceUrl(item.url);
		return url ? [{ ...item, url }] : [];
	});
	return (
		<section className="space-y-2" data-testid="measurement-references">
			<h4 className="text-xs text-muted-foreground">{mt("sources")}</h4>
			{safe.length ? (
				safe.map((item) => (
					<a
						key={item.url}
						href={item.url}
						target="_blank"
						rel="noopener noreferrer"
						className="block rounded-md border p-3 text-sm hover:bg-muted/30"
					>
						<span className="block font-medium">
							{item.title || new URL(item.url).hostname} <span aria-hidden="true">↗</span>
						</span>
						<span className="mt-1 block break-all text-xs text-blue-600">{item.url}</span>
					</a>
				))
			) : (
				<p className="text-xs text-muted-foreground">{mt("noSources")}</p>
			)}
		</section>
	);
}

function QueryAvailability({ record }: { record: PromptMeasurementRecord }) {
	if (record.queries.length)
		return (
			<div className="flex flex-wrap gap-1.5">
				{record.queries.map((query) => (
					<span key={query} className="rounded-md border px-2 py-1 text-xs">
						{query}
					</span>
				))}
			</div>
		);
	return (
		<div className="space-y-1 text-xs text-muted-foreground">
			<p>{mt(record.evidence.queryStatus === "not_used" ? "noSearch" : "notProvided")}</p>
			{record.evidence.queryStatus !== "not_used" && <p>{mt("noQueryClaim")}</p>}
		</div>
	);
}

function MeasurementRawOutput({ scope, record }: { scope: PromptMeasurementScope; record: PromptMeasurementRecord }) {
	const [open, setOpen] = useState(false);
	const result = useQuery({
		queryKey: ["prompt-measurement-raw", scope, record.id],
		queryFn: () => getPromptMeasurementDetailFn({ data: measurementDetailInput(scope, record) }),
		enabled: open,
		staleTime: 60_000,
	});
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)} className="border-t pt-3 text-xs">
			<summary className="cursor-pointer text-muted-foreground">{mt("raw")}</summary>
			{open && (
				<div className="mt-3 max-h-64 overflow-auto rounded-md border bg-muted/20 p-3">
					{result.isLoading ? (
						mt("loading")
					) : result.isError ? (
						mt("error")
					) : (
						<pre className="whitespace-pre-wrap break-words font-mono">
							{result.data?.rawOutput ?? JSON.stringify(result.data?.evidence, null, 2)}
						</pre>
					)}
				</div>
			)}
		</details>
	);
}

/** Pure card so state and safe external links can be asserted without router mocks. */
export function PromptMeasurementCard({
	label,
	record,
	configured,
	onQueries,
	rawOutput,
}: {
	label: string;
	record?: PromptMeasurementRecord;
	configured: boolean;
	onQueries?: (record: PromptMeasurementRecord) => void;
	rawOutput?: React.ReactNode;
}) {
	const state = measurementState(record);
	return (
		<Card className="min-w-0 h-full">
			<CardHeader className="border-b">
				<CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
					{label}
					<span
						className={`rounded-full px-2 py-1 text-xs font-normal ${state === "succeeded" ? "bg-emerald-50 text-emerald-700" : state === "failed" ? "bg-red-50 text-red-700" : "bg-muted text-muted-foreground"}`}
					>
						{mt(state)}
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-5 pt-4">
				{!record ? (
					<p className="text-sm text-muted-foreground">{mt(configured ? "unmeasured" : "unconfigured")}</p>
				) : (
					<>
						<dl className="grid grid-cols-3 gap-3 text-xs">
							<div>
								<dt className="mb-1 text-muted-foreground">{mt("provider")}</dt>
								<dd className="break-words">{record.provider}</dd>
							</div>
							<div>
								<dt className="mb-1 text-muted-foreground">{mt("version")}</dt>
								<dd className="break-words">{record.version ?? mt("notProvided")}</dd>
							</div>
							<div>
								<dt className="mb-1 text-muted-foreground">{mt("time")}</dt>
								<dd>{formatDateTime(record.completedAt ?? record.createdAt, { timeZoneName: "short" })}</dd>
							</div>
						</dl>
						<PromptRunContext context={record.requestContext} responseText={record.evidence.answerText} />
						{state === "failed" && (
							<p role="status" className="text-sm text-red-700">
								{mt("failedInfo")}
							</p>
						)}
						{state === "notShown" && (
							<p role="status" className="text-sm text-muted-foreground">
								{mt("notShownInfo")}
							</p>
						)}
						{state === "unknown" && (
							<p role="status" className="text-sm text-muted-foreground">
								{mt("unknownInfo")}
							</p>
						)}
						{record.evidence.answerStatus === "shown" && record.evidence.answerText && (
							<section className="space-y-2">
								<h4 className="text-xs text-muted-foreground">{mt("answer")}</h4>
								<div className="prose prose-sm max-w-none max-h-96 overflow-auto rounded-md border bg-muted/30 p-4 break-words">
									<ReactMarkdown
										components={{
											a: ({ href, children }) => {
												const url = safeEvidenceUrl(href);
												return url ? (
													<a href={url} target="_blank" rel="noopener noreferrer">
														{children}
													</a>
												) : (
													<span>{children}</span>
												);
											},
											img: () => null,
										}}
									>
										{record.evidence.answerText}
									</ReactMarkdown>
								</div>
							</section>
						)}
						<MeasurementSources citations={record.citations} />
						<section className="space-y-2">
							<h4 className="text-xs text-muted-foreground">{mt("queries")}</h4>
							<QueryAvailability record={record} />
							{onQueries && (
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0 text-xs"
									data-testid="measurement-queries"
									onClick={() => onQueries(record)}
								>
									{mt("viewQueries")}
								</Button>
							)}
						</section>
						{record.evidence.submittedPrompt && record.evidence.submittedPrompt !== record.requestContext?.prompt && (
							<details className="text-xs">
								<summary className="cursor-pointer text-muted-foreground">{mt("submitted")}</summary>
								<p className="mt-2 whitespace-pre-wrap break-words rounded-md border p-3">
									{record.evidence.submittedPrompt}
								</p>
							</details>
						)}
						{rawOutput}
					</>
				)}
			</CardContent>
		</Card>
	);
}

function ComparisonColumn({
	surface,
	targets,
	records,
	scope,
	onQueries,
}: {
	surface: "chatgpt_web" | "google_ai_overview";
	targets: PromptMeasurementTarget[];
	records: PromptMeasurementRecord[];
	scope: PromptMeasurementScope;
	onQueries: (record: PromptMeasurementRecord) => void;
}) {
	const [targetSelection, setTargetSelection] = useState("");
	const [recordSelection, setRecordSelection] = useState("");
	const options = targets
		.filter((target) => target.surface === surface)
		.sort((a, b) => Number(b.configured) - Number(a.configured));
	const target = options.find((item) => item.key === targetSelection) ?? options[0];
	const targetRecords = target
		? records.filter((item) => item.targetKey === target.key).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		: [];
	const record = targetRecords.find((item) => item.id === recordSelection) ?? targetRecords[0];
	const label = surface === "chatgpt_web" ? "ChatGPT Web" : "Google AI Overview";
	return (
		<section className="min-w-0 space-y-3" aria-label={label} data-testid={`measurement-target-${surface}`}>
			{options.length > 1 && (
				<label className="block space-y-1 text-xs text-muted-foreground">
					{mt("target")}
					<select
						className="h-9 w-full rounded-md border bg-background px-2 text-foreground"
						value={target?.key ?? ""}
						onChange={(event) => {
							setTargetSelection(event.target.value);
							setRecordSelection("");
						}}
					>
						{options.map((item) => (
							<option key={item.key} value={item.key}>
								{item.label} · {item.provider}
								{item.requestedVersion ? ` · ${item.requestedVersion}` : ""}
								{item.legacy ? ` · ${mt("legacy")}` : !item.configured ? ` · ${mt("historical")}` : ""}
							</option>
						))}
					</select>
				</label>
			)}
			{targetRecords.length > 1 && (
				<label className="block space-y-1 text-xs text-muted-foreground">
					{mt("answerSelection")}
					<select
						className="h-9 w-full rounded-md border bg-background px-2 text-foreground"
						value={record?.id ?? ""}
						onChange={(event) => setRecordSelection(event.target.value)}
					>
						{targetRecords.map((item) => (
							<option key={item.id} value={item.id}>
								{formatDateTime(item.createdAt, { timeZoneName: "short" })} · {mt(measurementState(item))}
							</option>
						))}
					</select>
				</label>
			)}
			<PromptMeasurementCard
				label={label}
				record={record}
				configured={Boolean(target?.configured)}
				onQueries={onQueries}
				rawOutput={record ? <MeasurementRawOutput scope={scope} record={record} /> : undefined}
			/>
		</section>
	);
}

export function PromptMeasurementComparison({
	scope,
	onQueries,
}: {
	scope: PromptMeasurementScope;
	onQueries: (record: PromptMeasurementRecord) => void;
}) {
	const result = useQuery({
		queryKey: ["prompt-measurements", scope],
		queryFn: () => getPromptMeasurementsFn({ data: { ...scope, timezone: APP_TIMEZONE } }),
		staleTime: 30_000,
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
	});
	if (result.isLoading)
		return (
			<p role="status" className="py-8 text-sm text-muted-foreground">
				{mt("loading")}
			</p>
		);
	if (result.isError || !result.data)
		return (
			<p role="alert" className="py-8 text-sm text-red-700">
				{mt("error")}
			</p>
		);
	return (
		<div className="space-y-4" data-testid="measurement-comparison">
			<p className="text-sm text-muted-foreground">{mt("compareInfo")}</p>
			<div className="grid items-start gap-4 xl:grid-cols-2">
				{(["chatgpt_web", "google_ai_overview"] as const).map((surface) => (
					<ComparisonColumn
						key={`${surface}:${scope.lookback}:${scope.language}`}
						surface={surface}
						targets={result.data.targets}
						records={result.data.records}
						scope={scope}
						onQueries={onQueries}
					/>
				))}
			</div>
		</div>
	);
}

/** Keep observed words visible for Japanese instead of the legacy ASCII-only tokenization. */
export function measurementQueryWords(queries: string[]): string[] {
	const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
	return [
		...new Set(
			queries.flatMap((query) =>
				[...segmenter.segment(query)].filter((part) => part.isWordLike).map((part) => part.segment.toLowerCase()),
			),
		),
	];
}

export function PromptMeasurementEvidence({ record }: { record: PromptMeasurementRecord }) {
	const queries = observedQueries([...record.queries, ...record.evidence.queryEvidence.map((item) => item.query)]);
	const words = measurementQueryWords(queries);
	return (
		<Tabs defaultValue="fanout" className="gap-4">
			<TabsList>
				<TabsTrigger value="fanout">{mt("queryFanout")}</TabsTrigger>
				<TabsTrigger value="words">{mt("words")}</TabsTrigger>
			</TabsList>
			<TabsContent value="fanout">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">{mt("queryFanout")}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-5">
						{queries.length ? (
							queries.map((query) => {
								const entries = record.evidence.queryEvidence.filter(
									(item) => item.query.trim().toLowerCase() === query.toLowerCase(),
								);
								return (
									<details key={query} className="rounded-md border text-sm">
										<summary className="cursor-pointer break-words p-3">{query}</summary>
										<div className="space-y-3 border-t bg-muted/20 p-3">
											<h4 className="text-xs font-medium">{mt("evidence")}</h4>
											{entries.some((item) => item.urls.some((source) => safeEvidenceUrl(source.url))) ? (
												entries.map((entry) => (
													<div key={entry.sourceField} className="space-y-2">
														<p className="text-xs text-muted-foreground">{mt("relationEvidence")}</p>
														{entry.urls.map((source) => {
															const url = safeEvidenceUrl(source.url);
															return url ? (
																<a
																	key={`${url}:${source.role}`}
																	href={url}
																	target="_blank"
																	rel="noopener noreferrer"
																	className="block rounded-md border bg-background p-3"
																>
																	<span className="block font-medium">{source.title || new URL(url).hostname} ↗</span>
																	<span className="mt-1 block break-all text-xs text-blue-600">{url}</span>
																	<span className="mt-1 block text-xs text-muted-foreground">
																		{mt(source.role === "unknown" ? "unknownRole" : source.role)}
																	</span>
																</a>
															) : null;
														})}
														<p className="break-all text-xs text-muted-foreground">
															{mt("field")}: {entry.sourceField}
														</p>
													</div>
												))
											) : (
												<p className="text-xs text-muted-foreground">{mt("noRelations")}</p>
											)}
										</div>
									</details>
								);
							})
						) : (
							<QueryAvailability record={record} />
						)}
						<MeasurementSources citations={record.citations} />
					</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="words">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">{mt("wordsScope")}</CardTitle>
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
							<p className="text-sm text-muted-foreground">{mt("noWords")}</p>
						)}
					</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	);
}

export function PromptMeasurementEvidencePanel({
	scope,
	selection,
	onClear,
}: {
	scope: PromptMeasurementScope;
	selection: PromptMeasurementSelection;
	onClear: () => void;
}) {
	const result = useQuery({
		queryKey: ["prompt-measurement-detail", scope, selection],
		queryFn: () => getPromptMeasurementDetailFn({ data: { ...scope, ...selection, timezone: APP_TIMEZONE } }),
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	});
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
				<p className="text-sm">
					{mt("exactAnswer")}:{" "}
					{result.data
						? `${measurementTargetLabel(result.data.model, result.data.provider)} · ${formatDateTime(result.data.createdAt, { timeZoneName: "short" })}`
						: "—"}
				</p>
				<Button size="sm" variant="outline" onClick={onClear}>
					{mt("clear")}
				</Button>
			</div>
			{result.isLoading ? (
				<p role="status" className="text-sm text-muted-foreground">
					{mt("loading")}
				</p>
			) : result.isError || !result.data ? (
				<p role="alert" className="text-sm text-red-700">
					{mt("scopeError")}
				</p>
			) : (
				<PromptMeasurementEvidence record={result.data} />
			)}
		</div>
	);
}
