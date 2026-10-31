import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Textarea } from "@workspace/ui/components/textarea";
import { AlertCircle, Loader2, Play, Rocket } from "lucide-react";
/**
 * Single-step onboarding wizard.
 *
 * One LLM call returns brand info + competitors + prompts; the user reviews
 * and edits before saving. Replaces the prior 4-step wizard that required
 * DataForSEO + Anthropic in tandem.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CompetitorEntry, CompetitorsEditor, newCompetitorEntry } from "@/components/competitors-editor";
import { type EditablePrompt, newPromptEntry, PromptsListEditor } from "@/components/prompts-list-editor";
import { brandKeys, useBrand } from "@/hooks/use-brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { promptsSummaryKeys } from "@/hooks/use-prompts-summary";
import { t } from "@/i18n";
import { brandCreationText as ct } from "@/i18n/brand-creation-labels";
import { localeText as lt } from "@/i18n/brand-locale-labels";
import { settingsError } from "@/i18n/settings-labels";
import { trackEvent } from "@/lib/posthog";
import {
	analyzeBrandInfoFn,
	analyzeCompetitorsFn,
	analyzePromptsFn,
	cancelAnalyzeBrandFn,
	updateOnboardedBrandFn,
} from "@/server/onboarding";
import { BrandLocaleFields } from "./brand-locale-fields";
import { WebLogo } from "./web-logo";

interface PromptWizardProps {
	onComplete: () => void;
	autoStart?: boolean;
}

/** Brand analysis runs in the worker (LLM + web search, ~1 min); the client polls for the result. */
const ANALYZE_TIMEOUT_MS = 6 * 60 * 1000; // give up after ~6 minutes

const analyzeStatusKey = (brandId: string) => ["analyze-brand", "status", brandId] as const;

interface WizardData {
	brandName: string;
	website: string;
	additionalDomains: string[];
	aliases: string[];
	competitors: CompetitorEntry[];
	prompts: EditablePrompt[];
	shortDescription?: string;
	productsAndServices?: string[];
	keywords?: string[];
}

const EditableTagsInput = memo(
	({
		items,
		onValueChange,
		placeholder = t("settings.addItem"),
		maxItems = 10,
	}: {
		items: string[];
		onValueChange: (value: string[]) => void;
		placeholder?: string;
		maxItems?: number;
	}) => (
		<div className="space-y-2">
			<TagsInput
				value={items}
				onValueChange={onValueChange}
				placeholder={placeholder}
				searchPlaceholder={placeholder}
				maxItems={maxItems}
			/>
			<p className="text-xs text-muted-foreground">
				{t(items.length >= maxItems ? "settings.itemsLimit" : "settings.itemsCount", {
					count: items.length,
					max: maxItems,
				})}
			</p>
		</div>
	),
);
EditableTagsInput.displayName = "EditableTagsInput";

export default function PromptWizard({ onComplete, autoStart = false }: PromptWizardProps) {
	const { brand } = useBrand();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [targetLanguage, setTargetLanguage] = useState(brand?.targetLanguage ?? "");
	const [targetMarket, setTargetMarket] = useState(brand?.targetMarket ?? "");
	const localeKey = JSON.stringify([targetLanguage, targetMarket]);
	const localeRef = useRef(localeKey);
	localeRef.current = localeKey;
	const [dataLocale, setDataLocale] = useState(localeKey);
	const STORAGE_KEY = brand?.id ? `getcito_onboarding_v2_${brand.id}_${encodeURIComponent(localeKey)}` : null;

	const [phase, setPhase] = useState<"idle" | "analyzing" | "review">(() => {
		if (typeof window !== "undefined" && STORAGE_KEY) {
			if (localStorage.getItem(STORAGE_KEY)) return "review";
		}
		return "idle";
	});
	const [error, setError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const [data, setData] = useState<WizardData>(() => {
		if (typeof window !== "undefined" && STORAGE_KEY) {
			const cached = localStorage.getItem(STORAGE_KEY);
			if (cached) {
				try {
					return JSON.parse(cached);
				} catch {
					// ignore
				}
			}
		}
		return {
			brandName: brand?.name || "",
			website: brand?.website || "",
			additionalDomains: brand?.additionalDomains || [],
			aliases: brand?.aliases || [],
			competitors: [],
			prompts: [],
		};
	});

	const brandId = brand?.id;

	// Stop polling, drop the cached status so the next run starts clean, and
	// (best-effort) cancel the worker job. `errorMessage` surfaces a reason
	// (timeout); a bare cancel passes null.
	const stopAnalyzing = useCallback(
		(errorMessage: string | null) => {
			setPhase("idle");
			setError(errorMessage);
			if (brandId) {
				queryClient.removeQueries({ queryKey: analyzeStatusKey(brandId) });
				cancelAnalyzeBrandFn({
					data: { brandId, targetLanguage: targetLanguage || null, targetMarket: targetMarket || null },
				}).catch(() => {});
			}
		},
		[brandId, queryClient, targetLanguage, targetMarket],
	);

	const { mutate: enqueueAnalysis, isPending: isAnalyzingBrand } = useMutation({
		mutationFn: (vars: {
			brandId: string;
			website: string;
			brandName?: string;
			targetLanguage: string | null;
			targetMarket: string | null;
		}) => analyzeBrandInfoFn({ data: vars }),
		onMutate: () => {
			setError(null);
			setPhase("analyzing");
		},
		onSuccess: (result, vars) => {
			if (JSON.stringify([vars.targetLanguage ?? "", vars.targetMarket ?? ""]) !== localeRef.current) return;
			setDataLocale(localeRef.current);
			const newData: WizardData = {
				...data,
				brandName: result.brandName || brand?.name || "",
				website: brand?.website || result.website || "",
				additionalDomains: result.additionalDomains,
				aliases: result.aliases,
				competitors: result.competitors.map((c) =>
					newCompetitorEntry({ name: c.name, domains: c.domains, aliases: c.aliases, expanded: false }),
				),
				prompts: result.suggestedPrompts.map((p) => newPromptEntry({ value: p.prompt, tags: p.tags, enabled: true })),
				shortDescription: result.shortDescription,
				productsAndServices: result.productsAndServices,
				keywords: result.keywords,
			};
			setData(newData);
			if (STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
			setPhase("review");
		},
		onError: (err) => {
			setError(settingsError(err, t("settings.analysisFailed")));
			setPhase("idle");
		},
	});

	const { mutate: enqueueCompetitorsAnalysis, isPending: isAnalyzingCompetitors } = useMutation({
		mutationFn: (vars: {
			brandId: string;
			website: string;
			brandName: string;
			targetLanguage: string | null;
			targetMarket: string | null;
		}) => analyzeCompetitorsFn({ data: vars }),
		onSuccess: (result, vars) => {
			if (JSON.stringify([vars.targetLanguage ?? "", vars.targetMarket ?? ""]) !== localeRef.current) return;
			setData((prev) => ({
				...prev,
				competitors: result.competitors.map((c) =>
					newCompetitorEntry({
						name: c.name,
						domains: c.domains,
						aliases: c.aliases,
						expanded: false,
					}),
				),
			}));
		},
		onError: (err) => {
			setError(settingsError(err, t("settings.competitorsAnalysisFailed")));
		},
	});

	const { mutate: enqueuePromptsAnalysis, isPending: isAnalyzingPrompts } = useMutation({
		mutationFn: (vars: {
			brandId: string;
			website: string;
			brandName: string;
			competitorNames: string[];
			targetLanguage: string | null;
			targetMarket: string | null;
		}) => analyzePromptsFn({ data: vars }),
		onSuccess: (result, vars) => {
			if (JSON.stringify([vars.targetLanguage ?? "", vars.targetMarket ?? ""]) !== localeRef.current) return;
			setData((prev) => ({
				...prev,
				prompts: result.suggestedPrompts.map((p) => newPromptEntry({ value: p.prompt, tags: p.tags, enabled: true })),
			}));
		},
		onError: (err) => {
			setError(settingsError(err, t("settings.promptsAnalysisFailed")));
		},
	});

	const handleAnalyze = useCallback(() => {
		if (!brand?.website || !brand?.id) return;
		enqueueAnalysis({
			brandId: brand.id,
			website: brand.website,
			brandName: brand.name,
			targetLanguage: targetLanguage || null,
			targetMarket: targetMarket || null,
		});
	}, [brand?.website, brand?.id, brand?.name, enqueueAnalysis, targetLanguage, targetMarket]);

	const handleAnalyzeCompetitors = useCallback(() => {
		if (!brand?.id) return;
		enqueueCompetitorsAnalysis({
			brandId: brand.id,
			website: data.website || brand.website,
			brandName: data.brandName || brand.name,
			targetLanguage: targetLanguage || null,
			targetMarket: targetMarket || null,
		});
	}, [brand, data.website, data.brandName, enqueueCompetitorsAnalysis, targetLanguage, targetMarket]);

	const handleAnalyzePrompts = useCallback(() => {
		if (!brand?.id) return;
		enqueuePromptsAnalysis({
			brandId: brand.id,
			website: data.website || brand.website,
			brandName: data.brandName || brand.name,
			targetLanguage: targetLanguage || null,
			targetMarket: targetMarket || null,
			competitorNames: data.competitors.map((c) => c.name).filter(Boolean),
		});
	}, [brand, data.website, data.brandName, data.competitors, enqueuePromptsAnalysis, targetLanguage, targetMarket]);

	const hasAutoAnalyzed = useRef(false);

	// Synchronize form progress to localStorage so hard refreshes don't lose data
	useEffect(() => {
		if (STORAGE_KEY && phase === "review" && dataLocale === localeKey) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		}
	}, [data, phase, STORAGE_KEY, dataLocale, localeKey]);

	// Auto-start analysis when component mounts
	useEffect(() => {
		if (autoStart && phase === "idle" && !hasAutoAnalyzed.current && brand?.website && brand?.id) {
			hasAutoAnalyzed.current = true;
			handleAnalyze();
		}
	}, [autoStart, brand?.website, brand?.id, phase, handleAnalyze]);

	// Update phase state to respect isAnalyzingBrand
	useEffect(() => {
		if (isAnalyzingBrand) setPhase("analyzing");
	}, [isAnalyzingBrand]);

	// Give up on a stuck analysis instead of polling forever.
	useEffect(() => {
		if (phase !== "analyzing") return;
		const timer = window.setTimeout(
			() => stopAnalyzing(t("settings.brandAnalysisTimedOutPleaseTryAgain")),
			ANALYZE_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [phase, stopAnalyzing]);

	const updateBrandName = useCallback((brandName: string) => setData((p) => ({ ...p, brandName })), []);
	const updateWebsite = useCallback((website: string) => setData((p) => ({ ...p, website })), []);
	const updateAliases = useCallback((aliases: string[]) => setData((p) => ({ ...p, aliases })), []);
	const updateAdditionalDomains = useCallback(
		(additionalDomains: string[]) => setData((p) => ({ ...p, additionalDomains })),
		[],
	);
	const updateCompetitors = useCallback(
		(competitors: CompetitorEntry[]) => setData((p) => ({ ...p, competitors })),
		[],
	);
	const updatePrompts = useCallback((prompts: EditablePrompt[]) => setData((p) => ({ ...p, prompts })), []);
	const updateShortDescription = useCallback(
		(shortDescription: string) => setData((p) => ({ ...p, shortDescription })),
		[],
	);
	const updateProductsAndServices = useCallback(
		(productsAndServices: string[]) => setData((p) => ({ ...p, productsAndServices })),
		[],
	);
	const updateKeywords = useCallback((keywords: string[]) => setData((p) => ({ ...p, keywords })), []);

	const previewCounts = useMemo(() => {
		const enabled = data.prompts.filter((p) => p.enabled && p.value.trim().length > 0).length;
		return { totalNew: enabled };
	}, [data.prompts]);

	const handleSubmit = useCallback(async () => {
		if (!brand?.id || dataLocale !== localeKey) return;
		setSubmitError(null);
		setIsSaving(true);
		try {
			const competitorsPayload = data.competitors
				.filter((c) => c.name.trim() && c.domains.some((d) => d.trim()))
				.map((c) => ({
					name: c.name.trim(),
					domains: c.domains.filter((d) => d.trim()),
					aliases: c.aliases,
				}));

			const promptsPayload = data.prompts
				.filter((p) => p.enabled && p.value.trim())
				.map((p) => ({ value: p.value.trim(), tags: p.tags, enabled: true }));

			await updateOnboardedBrandFn({
				data: {
					brandId: brand.id,
					brandName: data.brandName.trim() || brand.name,
					website: data.website.trim() || brand.website,
					additionalDomains: data.additionalDomains,
					aliases: data.aliases,
					competitors: competitorsPayload,
					prompts: promptsPayload,
					shortDescription: data.shortDescription,
					productsAndServices: data.productsAndServices,
					keywords: data.keywords,
					targetLanguage: targetLanguage || null,
					targetMarket: targetMarket || null,
				},
			});

			trackEvent("wizard_completed", {
				prompts_created: promptsPayload.length,
				competitors_created: competitorsPayload.length,
				skipped: false,
			});

			// Deployments without an onboardingRedirectUrlTemplate (e.g. local mode) skip the full reload, so caches fetched while !onboarded must be busted explicitly.
			queryClient.invalidateQueries({ queryKey: brandKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: promptsSummaryKeys.all });
			// The $brand route loader feeds `brand` into AppSidebar; invalidate it so the sidebar picks up onboarded=true.
			await router.invalidate();

			if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
			onComplete();
		} catch (err) {
			setSubmitError(settingsError(err, t("settings.failedToSave")));
		} finally {
			setIsSaving(false);
		}
	}, [brand, data, queryClient, router, onComplete, STORAGE_KEY, dataLocale, localeKey, targetLanguage, targetMarket]);

	const busy = isAnalyzingBrand || isAnalyzingCompetitors || isAnalyzingPrompts || isSaving;
	const localeFields = (
		<BrandLocaleFields
			targetLanguage={targetLanguage}
			targetMarket={targetMarket}
			onLanguageChange={setTargetLanguage}
			onMarketChange={setTargetMarket}
			disabled={busy}
		/>
	);

	if (phase === "idle" && !autoStart && !error) {
		return (
			<div className="space-y-4 rounded-xl border bg-card p-6">
				<h2 className="text-xl font-semibold">{ct("setupTitle")}</h2>
				<p className="text-sm leading-relaxed text-muted-foreground">{ct("setupDescription")}</p>
				{localeFields}
				<Button onClick={handleAnalyze}>
					<Play className="size-4" />
					{ct("startAnalysis")}
				</Button>
			</div>
		);
	}

	if (phase === "idle" || phase === "analyzing") {
		return (
			<div className="max-w-2xl mx-auto space-y-6">
				<div className="space-y-2">
					<h2 className="text-2xl font-bold">
						{t("settings.analyzingBrand", { brand: brand?.name || t("settings.brand") })}
					</h2>
					<p className="text-muted-foreground text-balance">
						{t("settings.analysisProgress", { website: brand?.website ?? "" })}
					</p>
				</div>

				{localeFields}
				{error ? (
					<div className="space-y-4">
						<div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
							<AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
							<span>{error}</span>
						</div>
						<Button onClick={handleAnalyze} className="flex items-center gap-2 cursor-pointer">
							<Play className="h-4 w-4" /> {t("settings.retryAnalysis")}
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span className="font-medium text-foreground">{t("settings.analyzingBrandData")}</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			{localeFields}
			{dataLocale !== localeKey && (
				<div className="space-y-2 rounded-md border p-3">
					<p role="status" className="text-sm">
						{lt("changed")}
					</p>
					<Button onClick={handleAnalyze} disabled={busy}>
						{lt("regenerate")}
					</Button>
				</div>
			)}

			<div className="space-y-2">
				<div className="flex items-center gap-4">
					<WebLogo domain={data.website} size={48} />
					<div>
						<h2 className="text-2xl font-bold">{t("settings.brandDetails")}</h2>
						<p className="text-muted-foreground">
							{t("settings.confirmTheBrandIdentityAdditionalDomainsAndAliasesUsed")}
						</p>
					</div>
				</div>
				<div className="space-y-3 mt-4">
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.brandName")}</p>
						<Input
							value={data.brandName}
							onChange={(e) => updateBrandName(e.target.value)}
							placeholder={t("settings.brandName")}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.websiteUrl")}</p>
						<Input
							type="url"
							value={data.website}
							onChange={(e) => updateWebsite(e.target.value)}
							placeholder="https://example.com"
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.additionalDomains2")}</p>
						<EditableTagsInput
							items={data.additionalDomains}
							onValueChange={updateAdditionalDomains}
							placeholder={t("settings.addDomain")}
							maxItems={10}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.aliases")}</p>
						<EditableTagsInput
							items={data.aliases}
							onValueChange={updateAliases}
							placeholder={t("settings.addAlias")}
							maxItems={10}
						/>
					</div>
				</div>
				<div className="space-y-3 mt-3">
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.shortDescription2")}</p>
						<Textarea
							value={data.shortDescription || ""}
							onChange={(e) => updateShortDescription(e.target.value)}
							placeholder={t("settings.briefSummaryOfTheBrand")}
							rows={3}
							className="resize-none"
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.productsAndServices")}</p>
						<EditableTagsInput
							items={data.productsAndServices || []}
							onValueChange={updateProductsAndServices}
							placeholder={t("settings.addProductOrService")}
							maxItems={20}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t("settings.keywords")}</p>
						<EditableTagsInput
							items={data.keywords || []}
							onValueChange={updateKeywords}
							placeholder={t("settings.addKeyword")}
							maxItems={20}
						/>
					</div>
				</div>
			</div>

			<Separator />

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold">{t("settings.competitors")}</h2>
						<p className="text-sm text-muted-foreground">{t("settings.companiesYouWantTrackedAlongsideYourBrand")}</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={handleAnalyzeCompetitors}
						disabled={busy || dataLocale !== localeKey}
					>
						{isAnalyzingCompetitors ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("settings.finding")}
							</>
						) : (
							t("settings.findCompetitors")
						)}
					</Button>
				</div>
				<CompetitorsEditor
					competitors={data.competitors}
					onChange={updateCompetitors}
					disabled={busy || dataLocale !== localeKey}
				/>
			</div>

			<Separator />

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold">{t("settings.prompts")}</h2>
						<p className="text-sm text-muted-foreground">
							{t("settings.pickWhichAiTrackingPromptsToStartWith")}
							<br /> {t("settings.untickAnyYouDonTWantEditTagsOr")}
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={handleAnalyzePrompts}
						disabled={busy || dataLocale !== localeKey}
					>
						{isAnalyzingPrompts ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("settings.suggesting")}
							</>
						) : (
							t("settings.suggestPrompts")
						)}
					</Button>
				</div>
				<PromptsListEditor prompts={data.prompts} onChange={updatePrompts} showSystemTags={false} />
			</div>

			{submitError && (
				<div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					<AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
					<div className="text-sm">{submitError}</div>
				</div>
			)}

			<Button
				onClick={handleSubmit}
				disabled={busy || dataLocale !== localeKey || previewCounts.totalNew === 0}
				className="flex items-center gap-2 cursor-pointer"
			>
				{isSaving ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> {t("settings.saving2")}
					</>
				) : (
					<>
						<Rocket className="h-4 w-4" /> {t("settings.startTracking", { count: previewCounts.totalNew })}
					</>
				)}
			</Button>
		</div>
	);
}
