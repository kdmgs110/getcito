import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BrandMention, BrandMentionAnalysis } from "@workspace/lib/brand-mentions";
import { Button } from "@workspace/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useBrandMentionRecount, mentionRecountKey } from "@/hooks/use-brand-mention-recount";
import { useBrand, useCompetitors } from "@/hooks/use-brands";
import { mt } from "@/i18n/brand-mentions-labels";
import { formatDateTime } from "@/lib/app-locale";
import { getPromptBrandMentionsFn } from "@/server/brand-mentions-read";
import { registerMentionBrandFn, retryMentionRecountFn } from "@/server/brand-mentions";

const kindStyles = {
	own: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
	competitor: "bg-muted text-foreground",
	unregistered: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};
const actionStyle = "text-xs text-blue-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-blue-400";

export function mentionRankLabel(mention: Pick<BrandMention, "rank" | "rankBasis">) {
	if (mention.rank === null) return mt("undetermined");
	return mt(mention.rankBasis === "explicit" ? "rank" : "order", { rank: mention.rank });
}

/** A single ordered list: classification never moves the own brand to the top. */
export function BrandMentionList({
	mentions,
	onRegister,
	onEvidence,
	compact = false,
}: {
	mentions: BrandMention[];
	onRegister?: (mention: BrandMention) => void;
	onEvidence?: (mention: BrandMention) => void;
	compact?: boolean;
}) {
	return (
		<ol className={cn("space-y-1", !compact && "space-y-2")} aria-label={mt("title")}>
			{mentions.map((mention) => (
				<li key={mention.key} className="flex min-w-0 items-start gap-2 text-xs leading-5">
					<span className="shrink-0 tabular-nums font-medium" title={mt(mention.rankBasis)}>
						{mentionRankLabel(mention)}
					</span>
					{onEvidence ? (
						<button
							type="button"
							className={cn("min-w-0 text-left hover:underline", compact ? "truncate" : "break-words")}
							title={`${mention.name} · ${mt("evidence")}`}
							onClick={() => onEvidence(mention)}
						>
							{mention.name}
						</button>
					) : (
						<span className={cn("min-w-0", compact ? "truncate" : "break-words")}>{mention.name}</span>
					)}
					<span className={cn("shrink-0 rounded px-1.5 text-[11px]", kindStyles[mention.kind])}>
						{mt(mention.kind)}
					</span>
					{mention.kind === "unregistered" && onRegister && (
						<button
							type="button"
							className="shrink-0 rounded border border-amber-300 px-1.5 text-xs hover:bg-amber-50 dark:hover:bg-amber-950"
							aria-label={mt("addNamed", { name: mention.name })}
							onClick={() => onRegister(mention)}
						>
							{mt("add")}
						</button>
					)}
				</li>
			))}
		</ol>
	);
}

export function BrandMentions({
	brandId,
	runId,
	analysis,
	fallbackNames = [],
	compact = false,
}: {
	brandId: string;
	runId: string;
	analysis?: BrandMentionAnalysis | null;
	fallbackNames?: string[];
	compact?: boolean;
}) {
	const [showAll, setShowAll] = useState(false);
	const [evidence, setEvidence] = useState<BrandMention | null>(null);
	const [registration, setRegistration] = useState<{ mention?: BrandMention } | null>(null);
	const mentions = analysis?.mentions ?? [];
	const basis =
		mentions.length && mentions.every((mention) => mention.rankBasis === mentions[0].rankBasis)
			? mentions[0].rankBasis
			: "unknown";
	const list = (preview: boolean) => (
		<>
			{mentions.length > 0 ? (
				<>
					<p className="mb-1 text-[11px] leading-4 text-muted-foreground">{mt(basis)}</p>
					<BrandMentionList
						mentions={preview ? mentions.slice(0, 3) : mentions}
						onEvidence={setEvidence}
						onRegister={(mention) => setRegistration({ mention })}
						compact={preview}
					/>
				</>
			) : (
				<p className="text-xs text-muted-foreground">
					{!analysis && fallbackNames.length ? `${fallbackNames.join("、")} (${mt("legacy")})` : mt("noMentions")}
				</p>
			)}
			<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
				{preview && mentions.length > 3 && (
					<button type="button" className={actionStyle} onClick={() => setShowAll(true)}>
						{mt("viewAll", { count: mentions.length })}
					</button>
				)}
				{mentions.length > 0 && (
					<button type="button" className={actionStyle} onClick={() => setEvidence(mentions[0])}>
						{mt("evidence")}
					</button>
				)}
				<button type="button" className={actionStyle} onClick={() => setRegistration({})}>
					{mt("manual")}
				</button>
			</div>
		</>
	);
	return (
		<div className="min-w-0" data-testid={`brand-mentions-${runId}`}>
			{list(compact)}
			{!compact && <p className="mt-3 text-xs text-muted-foreground">{mt("rankHelp")}</p>}
			<Dialog open={showAll} onOpenChange={setShowAll}>
				<DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{mt("title")}</DialogTitle>
						<DialogDescription>{mt("rankHelp")}</DialogDescription>
					</DialogHeader>
					{list(false)}
					<p className="text-xs text-muted-foreground">{mt("candidateHelp")}</p>
				</DialogContent>
			</Dialog>
			<Dialog
				open={evidence !== null}
				onOpenChange={(open) => {
					if (!open) setEvidence(null);
				}}
			>
				<DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{evidence?.name} — {mt("evidenceTitle")}
						</DialogTitle>
						<DialogDescription>{mt("rankHelp")}</DialogDescription>
					</DialogHeader>
					{evidence && (
						<>
							<p className="text-sm">
								{mt(evidence.rankBasis)}：{mentionRankLabel(evidence)}
							</p>
							<blockquote className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
								{evidence.evidence}
							</blockquote>
						</>
					)}
				</DialogContent>
			</Dialog>
			{registration && (
				<RegisterMentionDialog
					brandId={brandId}
					runId={runId}
					mention={registration.mention}
					onClose={() => setRegistration(null)}
				/>
			)}
		</div>
	);
}

function RegisterMentionDialog({
	brandId,
	runId,
	mention,
	onClose,
}: {
	brandId: string;
	runId: string;
	mention?: BrandMention;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const { brand, isLoading, isError } = useBrand(brandId);
	const { competitors, isLoading: competitorsLoading, isError: competitorsError } = useCompetitors(brandId);
	const [mode, setMode] = useState<"new" | "existing">("new");
	const [target, setTarget] = useState("own");
	const [name, setName] = useState(mention?.name ?? "");
	const [domain, setDomain] = useState(mention?.domain ?? "");
	const [aliases, setAliases] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(false);
	const fieldId = useId();
	const unavailable = isLoading || competitorsLoading || !!isError || !!competitorsError;

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim() || saving || unavailable) return;
		setSaving(true);
		setError(false);
		try {
			const result = await registerMentionBrandFn({
				data: {
					brandId,
					name: name.trim(),
					domain: domain.trim() || undefined,
					aliases: aliases
						.split(/[,、\n]/)
						.map((alias) => alias.trim())
						.filter(Boolean),
					target: mode === "new" ? "new" : target === "own" ? "own" : "competitor",
					competitorId: mode === "existing" && target !== "own" ? target : undefined,
					sourceRunId: runId,
				},
			});
			queryClient.setQueryData(mentionRecountKey(brandId), result.recount);
			await queryClient.invalidateQueries({ queryKey: ["brands"] });
			onClose();
		} catch {
			setError(true);
			setSaving(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<DialogContent
				className="max-h-[90dvh] overflow-auto sm:max-w-xl"
				onEscapeKeyDown={(event) => {
					if (saving) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>{mt("registerTitle")}</DialogTitle>
					<DialogDescription>{mt("registerDescription")}</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={(event) => void submit(event)}>
					{mention && (
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<p className="mb-1 font-medium">{mt("evidenceTitle")}</p>
							<p className="whitespace-pre-wrap break-words">{mention.evidence}</p>
						</div>
					)}
					<fieldset disabled={saving || unavailable} className="space-y-2">
						<legend className="sr-only">{mt("target")}</legend>
						{(["new", "existing"] as const).map((value) => (
							<label
								key={value}
								className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-foreground"
							>
								<input
									type="radio"
									name={`${fieldId}-mode`}
									value={value}
									checked={mode === value}
									onChange={() => setMode(value)}
								/>
								{mt(value === "new" ? "newBrand" : "existingBrand")}
							</label>
						))}
					</fieldset>
					{mode === "existing" && (
						<div className="space-y-1.5">
							<label htmlFor={`${fieldId}-target`} className="text-sm font-medium">
								{mt("target")}
							</label>
							<select
								id={`${fieldId}-target`}
								className="h-9 w-full rounded-md border bg-background px-3 text-sm"
								value={target}
								onChange={(event) => setTarget(event.target.value)}
								disabled={saving || unavailable}
							>
								<option value="own">
									{brand?.name}（{mt("own")}）
								</option>
								{competitors.map((competitor) => (
									<option key={competitor.id} value={competitor.id}>
										{competitor.name}（{mt("competitor")}）
									</option>
								))}
							</select>
						</div>
					)}
					<div className="space-y-1.5">
						<label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
							{mt("name")} *
						</label>
						<Input
							id={`${fieldId}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={200}
							required
							disabled={saving}
							autoComplete="off"
						/>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor={`${fieldId}-domain`} className="text-sm font-medium">
								{mt("domain")}
							</label>
							<Input
								id={`${fieldId}-domain`}
								value={domain}
								onChange={(event) => setDomain(event.target.value)}
								placeholder="example.com"
								maxLength={500}
								disabled={saving}
								autoComplete="off"
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor={`${fieldId}-aliases`} className="text-sm font-medium">
								{mt("aliases")}
							</label>
							<Input
								id={`${fieldId}-aliases`}
								value={aliases}
								onChange={(event) => setAliases(event.target.value)}
								placeholder={mt("aliasesHelp")}
								maxLength={2000}
								disabled={saving}
								autoComplete="off"
							/>
						</div>
					</div>
					<p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{mt("savedOnly")}</p>
					{(isError || competitorsError) && (
						<p role="alert" className="text-sm text-destructive">
							{mt("loadFailed")}
						</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{mt("failed")}
						</p>
					)}
					<div className="flex flex-wrap justify-end gap-2">
						<Button type="button" variant="outline" disabled={saving} onClick={onClose}>
							{mt("cancel")}
						</Button>
						<Button type="submit" disabled={saving || unavailable || !name.trim()}>
							{saving && <Loader2 className="size-4 animate-spin" />}
							{mt(saving ? "saving" : "submit")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function MentionRecountProgress({ brandId }: { brandId: string }) {
	const queryClient = useQueryClient();
	const query = useBrandMentionRecount(brandId);
	const [retrying, setRetrying] = useState(false);
	const [retryError, setRetryError] = useState(false);
	const data = query.data;
	async function retry() {
		setRetrying(true);
		setRetryError(false);
		try {
			queryClient.setQueryData(mentionRecountKey(brandId), await retryMentionRecountFn({ data: { brandId } }));
		} catch {
			setRetryError(true);
		} finally {
			setRetrying(false);
		}
	}
	if (!data || data.status === "idle") {
		return query.isError ? (
			<p role="alert" className="text-xs text-destructive">
				{mt("statusFailed")}{" "}
				<button type="button" className={actionStyle} onClick={() => void query.refetch()}>
					{mt("refresh")}
				</button>
			</p>
		) : null;
	}
	const active = data.status === "pending" || data.status === "running";
	const percent = data.total > 0 ? Math.min(100, Math.round((data.processed / data.total) * 100)) : 0;
	return (
		<div
			role="status"
			aria-live="polite"
			className={cn(
				"rounded-md border px-4 py-3 text-sm",
				data.status === "failed" ? "border-destructive/30" : "bg-muted/20",
			)}
			data-testid="mention-recount-status"
		>
			<div className="flex items-center gap-2">
				{active && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
				{data.status === "completed" && <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden="true" />}
				<span>
					{mt(
						data.status === "pending"
							? "pending"
							: data.status === "running"
								? "recount"
								: data.status === "completed"
									? "completed"
									: "recountFailed",
					)}
				</span>
			</div>
			{active && (
				<>
					<p className="mt-2 text-xs tabular-nums">
						{mt("progress", { processed: data.processed, total: data.total })} {data.total > 0 && `${percent}%`}
					</p>
					<progress
						className="mt-1 h-2 w-full max-w-md accent-blue-600"
						value={data.processed}
						max={Math.max(data.total, 1)}
						aria-label={mt("recount")}
					/>
					<p className="mt-1 text-xs text-muted-foreground">{mt("continue")}</p>
				</>
			)}
			{data.status === "failed" && (
				<Button variant="outline" size="sm" className="mt-2" onClick={() => void retry()} disabled={retrying}>
					{mt("retry")}
				</Button>
			)}
			{retryError && (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{mt("statusFailed")}
				</p>
			)}
		</div>
	);
}

export function PromptBrandMentions({
	brandId,
	promptId,
	lookback,
	model,
	targetKey,
	runId,
	attemptId,
	language,
}: {
	brandId: string;
	promptId: string;
	lookback: string;
	model?: string;
	targetKey?: string;
	runId?: string;
	attemptId?: string;
	language?: string;
}) {
	const query = useQuery({
		queryKey: ["prompt-brand-mentions", brandId, promptId, lookback, model, targetKey, runId, attemptId, language],
		queryFn: () =>
			getPromptBrandMentionsFn({ data: { brandId, promptId, lookback, model, targetKey, runId, attemptId, language } }),
		staleTime: 30_000,
	});
	return (
		<section aria-label={mt("title")} className="space-y-4 rounded-lg border bg-background p-5">
			<div>
				<h2 className="font-semibold">{mt("title")}</h2>
				<p className="mt-1 text-xs text-muted-foreground">{mt("latest")}</p>
			</div>
			<MentionRecountProgress brandId={brandId} />
			{query.isLoading ? (
				<p role="status" className="text-sm text-muted-foreground">
					{mt("loading")}
				</p>
			) : query.isError ? (
				<p role="alert" className="text-sm text-destructive">
					{mt("readFailed")}{" "}
					<button type="button" className={actionStyle} onClick={() => void query.refetch()}>
						{mt("refresh")}
					</button>
				</p>
			) : !query.data?.answers.length ? (
				<p className="text-sm text-muted-foreground">{mt("missing")}</p>
			) : (
				<div className="grid gap-5 md:grid-cols-2">
					{query.data.answers.map((answer) => (
						<section key={answer.runId} className="min-w-0 space-y-3 rounded-md border p-4">
							<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
								<h3 className="font-medium">{answer.modelLabel}</h3>
								<time dateTime={answer.createdAt} className="text-xs tabular-nums text-muted-foreground">
									{formatDateTime(answer.createdAt)}
								</time>
							</div>
							<BrandMentions brandId={brandId} runId={answer.runId} analysis={answer.mentionAnalysis} />
						</section>
					))}
				</div>
			)}
			<p className="text-xs text-muted-foreground">{mt("candidateHelp")}</p>
		</section>
	);
}
