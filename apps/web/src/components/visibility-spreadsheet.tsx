import { useVirtualizer } from "@tanstack/react-virtual";
import { safeEvidenceUrl } from "@workspace/lib/measurement";
import { Button } from "@workspace/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { Download, Table2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { SiGoogle, SiOpenai } from "react-icons/si";
import ReactMarkdown from "react-markdown";
import { useVisibilitySpreadsheet } from "@/hooks/use-visibility-spreadsheet";
import { st } from "@/i18n/visibility-spreadsheet-labels";
import { formatDateTime } from "@/lib/app-locale";
import type { LookbackPeriod } from "@/lib/chart-utils";
import type { SpreadsheetAnswer, VisibilitySpreadsheetRow } from "@/lib/visibility-spreadsheet";
import {
	collectSpreadsheetCsv,
	type EvidenceMode,
	spreadsheetAnswerText,
	spreadsheetEvidence,
	spreadsheetQueries,
} from "@/lib/visibility-spreadsheet-csv";
import { getVisibilitySpreadsheetRowsFn } from "@/server/visibility-spreadsheet";

// Fixed-height, clipped previews keep the DOM bounded; complete values are available in the dialog and CSV.
const ROW_HEIGHT = 156;
const GRID = "44px 260px 160px 156px 360px 220px 340px 380px 360px";
const TABLE_WIDTH = 2280;
const CELL = "h-full min-w-0 overflow-hidden border-r border-b p-3 text-xs leading-relaxed";
const promptSticky = "md:sticky md:left-11 md:z-10 bg-background";
const tagsSticky = "md:sticky md:left-[304px] md:z-10 bg-muted shadow-sm";

export function VisibilitySpreadsheet({
	brandId,
	prompts,
	lookback,
}: {
	brandId: string;
	prompts: { id: string; value: string }[];
	lookback: LookbackPeriod;
}) {
	const promptIds = useMemo(() => prompts.map((prompt) => prompt.id), [prompts]);
	// A filter/order change discards scroll, snapshot and any pending CSV export together.
	return (
		<SpreadsheetSession
			key={JSON.stringify([brandId, lookback, promptIds])}
			brandId={brandId}
			promptIds={promptIds}
			lookback={lookback}
		/>
	);
}

function SpreadsheetSession({
	brandId,
	promptIds,
	lookback,
}: {
	brandId: string;
	promptIds: string[];
	lookback: LookbackPeriod;
}) {
	const data = useVisibilitySpreadsheet({ brandId, promptIds, lookback });
	const scrollRef = useRef<HTMLElement>(null);
	const [mode, setMode] = useState<EvidenceMode>("domain");
	const [selected, setSelected] = useState<VisibilitySpreadsheetRow | null>(null);
	const [exportProgress, setExportProgress] = useState<number | null>(null);
	const [exportError, setExportError] = useState(false);
	const exportController = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			exportController.current?.abort();
		};
	}, []);

	const virtualizer = useVirtualizer({
		count: data.rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 4,
		getItemKey: (index) => data.rows[index].id,
		// Two sticky header rows sit before the virtual body.
		scrollMargin: 96,
	});
	const items = virtualizer.getVirtualItems();
	const lastIndex = items.at(-1)?.index ?? -1;
	useEffect(() => {
		if (lastIndex >= data.rows.length - 5 && data.hasNextPage && !data.isFetchingNextPage && !data.isError) {
			void data.fetchNextPage();
		}
	}, [lastIndex, data.rows.length, data.hasNextPage, data.isFetchingNextPage, data.isError, data.fetchNextPage]);

	async function exportCsv() {
		if (exportController.current) return;
		const controller = new AbortController();
		exportController.current = controller;
		setExportProgress(0);
		setExportError(false);
		try {
			const blob = await collectSpreadsheetCsv({
				promptIds,
				mode,
				signal: controller.signal,
				asOf: data.asOf,
				onProgress: setExportProgress,
				fetchBatch: (ids, asOf) =>
					getVisibilitySpreadsheetRowsFn({ data: { brandId, promptIds: ids, lookback, asOf } }),
			});
			controller.signal.throwIfAborted();
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `visibility-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.append(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch {
			if (!controller.signal.aborted) setExportError(true);
		} finally {
			if (mounted.current) setExportProgress(null);
			exportController.current = null;
		}
	}

	return (
		<section aria-label={st("spreadsheet")} className="min-w-0 space-y-2">
			<p className="text-pretty text-xs text-muted-foreground">{st("comparison")}</p>
			<div className="overflow-hidden rounded-lg border bg-background">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
					<div className="flex items-center gap-2">
						<Table2 className="size-4" />
						<h2 className="text-balance text-sm font-semibold">{st("spreadsheet")}</h2>
						<span className="text-xs tabular-nums text-muted-foreground">
							{st("count", { count: promptIds.length })}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-xs text-muted-foreground">{st("exportScope")}</span>
						<Button
							variant="outline"
							size="sm"
							disabled={exportProgress !== null || data.isLoading || !promptIds.length}
							onClick={() => void exportCsv()}
						>
							<Download className="size-4" />
							{exportProgress === null ? st("export") : `${st("exporting")} ${exportProgress}/${promptIds.length}`}
						</Button>
						{exportProgress !== null && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									exportController.current?.abort();
								}}
							>
								{st("cancel")}
							</Button>
						)}
					</div>
				</div>
				{exportError && (
					<p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
						{st("exportError")}
					</p>
				)}
				<section
					ref={scrollRef}
					data-testid="visibility-spreadsheet-scroll"
					className="max-h-[70dvh] min-h-64 overflow-auto"
					aria-label={st("tableScroll")}
				>
					<table
						className="grid border-collapse text-left"
						style={{ width: TABLE_WIDTH }}
						aria-rowcount={promptIds.length + 2}
					>
						<caption className="sr-only">{st("comparison")}</caption>
						<thead className="sticky top-0 z-30 grid bg-muted">
							<tr className="grid h-9 border-b text-xs" style={{ gridTemplateColumns: GRID }}>
								<th
									colSpan={4}
									scope="colgroup"
									className="flex items-center justify-center border-r font-medium"
									style={{ gridColumn: "span 4" }}
								>
									{st("common")}
								</th>
								<th
									colSpan={4}
									scope="colgroup"
									className="flex items-center justify-center gap-2 border-r font-medium"
									style={{ gridColumn: "span 4" }}
								>
									<SiOpenai />
									ChatGPT Web
								</th>
								<th scope="colgroup" className="flex items-center justify-center gap-2 font-medium">
									<SiGoogle />
									Google AIモード
								</th>
							</tr>
							<tr className="grid h-15 text-xs" style={{ gridTemplateColumns: GRID }}>
								<th scope="col" className={cn(CELL, "bg-muted")}>
									<span className="sr-only">#</span>
								</th>
								<th scope="col" className={cn(CELL, promptSticky, "bg-muted")}>
									{st("prompt")}
								</th>
								<th scope="col" className={cn(CELL, tagsSticky)}>
									{st("tags")}
								</th>
								<th scope="col" className={CELL}>
									{st("lastRun")}
								</th>
								<th scope="col" className={CELL}>
									{st("chatgpt")}
								</th>
								<th scope="col" className={CELL}>
									{st("brands")}
									<span className="block font-normal text-muted-foreground">{st("registeredBrands")}</span>
								</th>
								<th scope="col" className={CELL}>
									{st("queries")}
								</th>
								<th scope="col" className={cn(CELL, "py-1.5")}>
									<span>{st("evidence")}</span>
									<Tabs value={mode} onValueChange={(next) => setMode(next as EvidenceMode)}>
										<TabsList className="mt-1 h-6">
											<TabsTrigger value="domain" className="px-2 py-0 text-xs">
												{st("domain")}
											</TabsTrigger>
											<TabsTrigger value="page" className="px-2 py-0 text-xs">
												{st("page")}
											</TabsTrigger>
										</TabsList>
									</Tabs>
								</th>
								<th scope="col" className={CELL}>
									{st("aiMode")}
								</th>
							</tr>
						</thead>
						<tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
							{items.map((item) => (
								<SpreadsheetRow
									key={item.key}
									row={data.rows[item.index]}
									index={item.index}
									top={item.start - 96}
									mode={mode}
									onSelect={setSelected}
								/>
							))}
						</tbody>
					</table>
					{data.isLoading && (
						<div className="space-y-2 p-4" role="status" aria-label={st("loading")}>
							{[1, 2, 3].map((key) => (
								<Skeleton key={key} className="h-24 w-full" />
							))}
						</div>
					)}
				</section>
				<div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
					<span role="status" className="tabular-nums">
						{st("loaded", { total: promptIds.length, count: data.loadedCount })}
					</span>
					{data.isError ? (
						<div className="flex items-center gap-2">
							<span role="alert">{st("error")}</span>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void (data.hasNextPage ? data.fetchNextPage() : data.refetch())}
							>
								{st("retry")}
							</Button>
						</div>
					) : data.hasNextPage ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={data.isFetchingNextPage}
							onClick={() => void data.fetchNextPage()}
						>
							{data.isFetchingNextPage ? st("loading") : st("more")}
						</Button>
					) : (
						<span>{st("footer")}</span>
					)}
				</div>
			</div>
			<Dialog
				open={!!selected}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-5xl">
					<DialogHeader>
						<DialogTitle className="text-balance leading-relaxed">{selected?.value}</DialogTitle>
						<DialogDescription>{st("detailDescription")}</DialogDescription>
					</DialogHeader>
					{selected && (
						<>
							<div className="flex flex-wrap gap-1">
								{selected.tags.map((tag) => (
									<Chip key={tag}>{tag}</Chip>
								))}
							</div>
							<AnswerDetail label="ChatGPT Web" answer={selected.chatgpt} />
							<AnswerDetail label="Google AIモード" answer={selected.aiMode} />
						</>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}

const SpreadsheetRow = memo(function SpreadsheetRow({
	row,
	index,
	top,
	mode,
	onSelect,
}: {
	row: VisibilitySpreadsheetRow;
	index: number;
	top: number;
	mode: EvidenceMode;
	onSelect: (row: VisibilitySpreadsheetRow) => void;
}) {
	return (
		<tr
			data-testid={`spreadsheet-row-${row.id}`}
			aria-rowindex={index + 3}
			className="absolute left-0 grid w-full bg-background"
			style={{ height: ROW_HEIGHT, top, gridTemplateColumns: GRID }}
		>
			<td className={cn(CELL, "tabular-nums text-muted-foreground")}>{index + 1}</td>
			<th scope="row" className={cn(CELL, promptSticky, "font-medium")}>
				<span className="line-clamp-5 text-pretty">{row.value}</span>
				<button
					type="button"
					className="mt-2 text-xs font-normal text-blue-600 underline-offset-2 hover:underline"
					onClick={() => onSelect(row)}
				>
					{st("details")}
				</button>
			</th>
			<td className={cn(CELL, tagsSticky)}>
				<div className="flex max-h-36 flex-wrap content-start gap-1 overflow-auto">
					{row.tags.length ? row.tags.map((tag) => <Chip key={tag}>{tag}</Chip>) : <Muted>{st("noTags")}</Muted>}
				</div>
			</td>
			<td className={cn(CELL, "tabular-nums")}>
				<DateLabel value={row.lastRunAt} />
			</td>
			<td className={CELL}>
				<AnswerPreview answer={row.chatgpt} onClick={() => onSelect(row)} />
			</td>
			<td className={CELL}>
				<div className="flex max-h-32 flex-wrap content-start gap-1 overflow-hidden">
					{row.chatgpt ? (
						row.chatgpt.mentionedBrands.length ? (
							row.chatgpt.mentionedBrands.map((name) => <Chip key={name}>{name}</Chip>)
						) : (
							<Muted>{st("noBrands")}</Muted>
						)
					) : (
						<Muted>{st("missing")}</Muted>
					)}
				</div>
				{(row.chatgpt?.mentionedBrands.length ?? 0) > 4 && <DetailButton onClick={() => onSelect(row)} />}
			</td>
			<td className={CELL}>
				<p className="line-clamp-5 whitespace-pre-line break-words">{spreadsheetQueries(row.chatgpt)}</p>
				{!!row.chatgpt?.webQueries.length && <DetailButton onClick={() => onSelect(row)} />}
			</td>
			<td className={CELL}>
				<EvidencePreview answer={row.chatgpt} mode={mode} />
				<DetailButton onClick={() => onSelect(row)} />
			</td>
			<td className={CELL}>
				<AnswerPreview answer={row.aiMode} onClick={() => onSelect(row)} showDate />
			</td>
		</tr>
	);
});

function Chip({ children }: { children: React.ReactNode }) {
	return (
		<span className="max-w-full break-words rounded-md bg-muted-foreground/10 px-2 py-0.5 text-xs font-normal">
			{children}
		</span>
	);
}
function Muted({ children }: { children: React.ReactNode }) {
	return <span className="text-xs text-muted-foreground">{children}</span>;
}
function DateLabel({ value }: { value: string | null }) {
	return value ? (
		<time dateTime={value} className="text-xs tabular-nums">
			{formatDateTime(value, { year: "numeric", month: "2-digit", day: "2-digit" })}
			<br />
			{formatDateTime(value, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
		</time>
	) : (
		<Muted>{st("missing")}</Muted>
	);
}
function DetailButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			className="mt-2 block text-xs text-blue-600 underline-offset-2 hover:underline"
			onClick={onClick}
		>
			{st("details")}
		</button>
	);
}
function AnswerPreview({
	answer,
	onClick,
	showDate = false,
}: {
	answer: SpreadsheetAnswer | null;
	onClick: () => void;
	showDate?: boolean;
}) {
	return (
		<>
			<p
				className={cn(
					"line-clamp-3 whitespace-pre-line break-words text-pretty",
					!answer?.answerText && "text-muted-foreground",
				)}
			>
				{spreadsheetAnswerText(answer)}
			</p>
			{showDate && answer && (
				<div className="mt-1 text-muted-foreground">
					<DateLabel value={answer.createdAt} />
				</div>
			)}
			{answer && (
				<button
					type="button"
					className="mt-2 block text-xs text-blue-600 underline-offset-2 hover:underline"
					onClick={onClick}
				>
					{st("full")}
				</button>
			)}
		</>
	);
}
function EvidencePreview({ answer, mode }: { answer: SpreadsheetAnswer | null; mode: EvidenceMode }) {
	if (!answer) return <Muted>{st("missing")}</Muted>;
	const items =
		mode === "domain"
			? answer.domains.map((item) => ({ ...item, label: item.domain }))
			: answer.pages.map((item) => ({ ...item, label: item.url }));
	if (!items.length) return <Muted>{spreadsheetEvidence(answer, mode)}</Muted>;
	return (
		<div className="space-y-1">
			<div className="grid grid-cols-[1fr_2.5rem_2.5rem] gap-2 text-right text-muted-foreground">
				<span />
				<span>{st("appearances")}</span>
				<span>{st("citations")}</span>
			</div>
			{items.slice(0, 3).map((item) => (
				<div
					key={item.label}
					className="grid grid-cols-[1fr_2.5rem_2.5rem] gap-2 border-b border-border/50 tabular-nums"
				>
					<span className="truncate" title={item.label}>
						{item.label}
					</span>
					<span className="text-right">{item.appearances ?? "—"}</span>
					<span className="text-right">{item.citations ?? "—"}</span>
				</div>
			))}
			{(answer.searchResultsStatus === "unknown" || answer.citationsStatus === "unknown") && (
				<Muted>— {st("unknown")}</Muted>
			)}
		</div>
	);
}

function AnswerDetail({ label, answer }: { label: string; answer: SpreadsheetAnswer | null }) {
	return (
		<section className="min-w-0 space-y-3 border-t pt-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-balance font-semibold">{label}</h3>
				<DateLabel value={answer?.createdAt ?? null} />
			</div>
			<div className="prose prose-sm dark:prose-invert max-w-none break-words">
				<ReactMarkdown>{spreadsheetAnswerText(answer)}</ReactMarkdown>
			</div>
			{answer && (
				<>
					<h4 className="text-sm font-medium">
						{st("brands")} <Muted>{st("registeredBrands")}</Muted>
					</h4>
					<div className="flex flex-wrap gap-1">
						{answer.mentionedBrands.length ? (
							answer.mentionedBrands.map((name) => <Chip key={name}>{name}</Chip>)
						) : (
							<Muted>{st("noBrands")}</Muted>
						)}
					</div>
					<h4 className="text-sm font-medium">{st("queries")}</h4>
					<p className="whitespace-pre-line break-words text-sm">{spreadsheetQueries(answer)}</p>
					<h4 className="text-sm font-medium">{st("evidence")}</h4>
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="border-b">
									<th className="py-2">URL</th>
									<th className="p-2">{st("appearances")}</th>
									<th className="p-2">{st("citations")}</th>
								</tr>
							</thead>
							<tbody>
								{answer.pages.map((page) => (
									<tr key={page.url} className="border-b">
										<td className="max-w-96 break-words py-2">
											{safeEvidenceUrl(page.url) ? (
												<a
													href={page.url}
													target="_blank"
													rel="noopener noreferrer"
													className="text-blue-600 underline"
												>
													{page.url}
												</a>
											) : (
												page.url
											)}
											{page.title && <p className="mt-1 text-muted-foreground">{page.title}</p>}
										</td>
										<td className="p-2 tabular-nums">{page.appearances ?? st("unknown")}</td>
										<td className="p-2 tabular-nums">{page.citations ?? st("unknown")}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{!answer.pages.length && <Muted>{spreadsheetEvidence(answer, "page")}</Muted>}
				</>
			)}
		</section>
	);
}
