import { Link } from "@tanstack/react-router";
import { resolveBrandLocale } from "@workspace/lib/brand-locale";
import { MAX_PROMPTS } from "@workspace/lib/constants";
import { Button } from "@workspace/ui/components/button";
import { useRef, useState } from "react";
import { useBrand } from "@/hooks/use-brands";
import { localeText as lt } from "@/i18n/brand-locale-labels";
import { displayLanguage, displayMarket } from "@/i18n/settings-labels";
import { mergePromptSuggestions } from "@/lib/prompt-suggestions";
import { analyzePromptsFn, translateBrandPromptsFn } from "@/server/onboarding";
import { type EditablePrompt, newPromptEntry, PromptsListEditor } from "./prompts-list-editor";

export function PromptLanguageSuggestions({
	prompts,
	onAdopt,
	disabled = false,
}: {
	prompts: EditablePrompt[];
	onAdopt: (prompts: EditablePrompt[]) => void;
	disabled?: boolean;
}) {
	const { brand } = useBrand();
	const [suggestions, setSuggestions] = useState<EditablePrompt[] | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [resultLocale, setResultLocale] = useState("");
	const localeKey = JSON.stringify([brand?.id, brand?.targetLanguage, brand?.targetMarket]);
	const currentLocale = useRef(localeKey);
	currentLocale.current = localeKey;
	let locale: ReturnType<typeof resolveBrandLocale> = {};
	let invalidLocale = false;
	try {
		locale = resolveBrandLocale(brand ?? {});
	} catch {
		invalidLocale = true;
	}
	const generate = async (translate: boolean) => {
		if (!brand || busy) return;
		const requestedLocale = localeKey;
		setBusy(true);
		setError("");
		setSuggestions(null);
		try {
			const data = { brandId: brand.id, targetLanguage: brand.targetLanguage, targetMarket: brand.targetMarket };
			const result = translate
				? await translateBrandPromptsFn({
						data: {
							...data,
							prompts: prompts
								.filter((p) => p.enabled && p.value.trim())
								.slice(0, 30)
								.map((p) => ({ prompt: p.value, tags: p.tags })),
						},
					})
				: await analyzePromptsFn({ data: { ...data, website: brand.website, brandName: brand.name } });
			if (requestedLocale !== currentLocale.current) {
				setError(lt("stale"));
				return;
			}
			setSuggestions(
				result.suggestedPrompts.map((p) => newPromptEntry({ value: p.prompt, tags: p.tags, enabled: true })),
			);
			setResultLocale(requestedLocale);
		} catch {
			setError(lt("error"));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="space-y-3 rounded-lg border p-4" aria-label={lt("preview")}>
			<p className="text-sm font-medium">
				{lt("language")}:{" "}
				{locale.languageCode ? displayLanguage(locale.languageCode, locale.languageName ?? "") : lt("unconfigured")} ·{" "}
				{lt("market")}: {locale.countryName ? displayMarket(locale.countryName) : lt("unconfigured")}
			</p>
			<p className="text-xs leading-relaxed text-muted-foreground">{lt("preserve")}</p>
			{brand && (
				<Link
					to="/app/$brand/settings/brand"
					params={{ brand: brand.id }}
					className="text-sm underline underline-offset-4"
				>
					{lt("settings")}
				</Link>
			)}
			{invalidLocale && (
				<p role="alert" className="text-sm text-destructive">
					{lt("error")}
				</p>
			)}
			<p className="text-xs text-muted-foreground">{lt("limits")}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => generate(false)}
					disabled={disabled || busy || !brand || invalidLocale}
				>
					{busy ? lt("working") : lt("suggest")}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => generate(true)}
					disabled={
						disabled ||
						busy ||
						invalidLocale ||
						!locale.languageCode ||
						!prompts.some((p) => p.enabled && p.value.trim())
					}
				>
					{lt("translate")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			{suggestions && (
				<>
					<h2 className="text-base font-semibold">{lt("preview")}</h2>
					<p className="text-xs text-muted-foreground">
						{lt("capacity")} {Math.max(0, MAX_PROMPTS - prompts.length)}
					</p>
					{resultLocale !== localeKey && (
						<p role="status" className="text-sm">
							{lt("stale")}
						</p>
					)}
					<PromptsListEditor prompts={suggestions} onChange={setSuggestions} showSystemTags={false} />
					<Button
						type="button"
						size="sm"
						disabled={
							disabled ||
							busy ||
							resultLocale !== localeKey ||
							!suggestions.some((p) => p.enabled && p.value.trim()) ||
							prompts.length >= MAX_PROMPTS
						}
						onClick={() => {
							onAdopt(mergePromptSuggestions(prompts, suggestions));
							setSuggestions(null);
						}}
					>
						{lt("adopt")}
					</Button>
				</>
			)}
		</section>
	);
}
