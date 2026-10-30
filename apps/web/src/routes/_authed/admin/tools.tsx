import { APP_LANGUAGE, UI_LOCALE, t } from "@/i18n";
/**
 * /admin/tools — Admin utility for running the onboarding analysis against an
 * arbitrary website without going through the wizard.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getAppName } from "@/lib/route-head";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Sparkles, Loader2, Copy, Check } from "lucide-react";
import { adminAnalyzeBrandFn } from "@/server/admin";
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";

function AnalyzeBrandDialog() {
	const [open, setOpen] = useState(false);
	const [website, setWebsite] = useState("");
	const [brandName, setBrandName] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<OnboardingSuggestion | null>(null);
	const [copied, setCopied] = useState(false);

	const handleAnalyze = async () => {
		if (!website.trim()) {
			setError(t("reports.pleaseEnterAWebsiteUrl"));
			return;
		}
		setError(null);
		setResult(null);
		setIsLoading(true);
		try {
			const data = await adminAnalyzeBrandFn({
				data: {
					website: website.trim(),
					brandName: brandName.trim() || undefined,
				},
			});
			setResult(data);
		} catch (err) {
			setError(APP_LANGUAGE === "en" && err instanceof Error ? err.message : t("reports.anErrorOccurred"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleCopy = async () => {
		if (!result) return;
		await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleCopyPrompts = async () => {
		if (!result) return;
		await navigator.clipboard.writeText(result.suggestedPrompts.map((p) => p.prompt).join("\n"));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleClose = () => {
		setOpen(false);
		setWebsite("");
		setBrandName("");
		setResult(null);
		setError(null);
	};

	return (
		<Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
			<DialogTrigger asChild>
				<Button variant="outline" className="cursor-pointer w-full">
					<Sparkles className="h-4 w-4 mr-2" />
					{t("reports.analyzeBrand")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("reports.analyzeBrand")}</DialogTitle>
					<DialogDescription>{t("reports.runTheOnboardingAnalysisForAnyWebsite")}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="analyze-website">{t("reports.websiteUrl")}</Label>
							<Input
								id="analyze-website"
								placeholder="https://example.com"
								value={website}
								onChange={(e) => setWebsite(e.target.value)}
								disabled={isLoading}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="analyze-brand">{t("reports.brandNameOptional")}</Label>
							<Input
								id="analyze-brand"
								placeholder={t("reports.autoDetectedFromUrl")}
								value={brandName}
								onChange={(e) => setBrandName(e.target.value)}
								disabled={isLoading}
							/>
						</div>
					</div>

					<Button onClick={handleAnalyze} disabled={isLoading} className="cursor-pointer w-full">
						{isLoading ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								{t("reports.analyzingThisMayTakeAMinute")}
							</>
						) : (
							t("reports.analyze")
						)}
					</Button>

					{error && <p className="text-sm text-destructive">{error}</p>}

					{result && (
						<div className="space-y-4">
							<div className="flex items-center justify-between">
								<h4 className="font-semibold">{result.brandName}</h4>
								<div className="flex gap-2">
									<Button variant="ghost" size="sm" onClick={handleCopyPrompts} className="cursor-pointer">
										{copied ? (
											<>
												<Check className="h-4 w-4 mr-1" /> {t("reports.copied")}
											</>
										) : (
											<>
												<Copy className="h-4 w-4 mr-1" /> {t("reports.copyPrompts")}
											</>
										)}
									</Button>
									<Button variant="ghost" size="sm" onClick={handleCopy} className="cursor-pointer">
										<Copy className="h-4 w-4 mr-1" /> {t("reports.copyJson")}
									</Button>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4 text-sm">
								<Stat label={t("reports.competitors")} value={result.competitors.length} />
								<Stat label={t("reports.prompts")} value={result.suggestedPrompts.length} />
							</div>

							{result.additionalDomains.length > 0 && (
								<TagSection title={t("reports.additionalDomains")} items={result.additionalDomains} />
							)}
							{result.aliases.length > 0 && <TagSection title={t("reports.aliases")} items={result.aliases} />}

							{result.competitors.length > 0 && (
								<div className="space-y-2">
									<Label className="text-muted-foreground">{t("reports.competitors")}</Label>
									<div className="space-y-1 text-sm">
										{result.competitors.map((c) => (
											<div key={c.name} className="flex items-center gap-2">
												<span className="font-medium">{c.name}</span>
												<span className="text-muted-foreground">({c.domains.join(", ") || "—"})</span>
											</div>
										))}
									</div>
								</div>
							)}

							{result.suggestedPrompts.length > 0 && (
								<div className="space-y-2">
									<Label className="text-muted-foreground">{t("reports.prompts")}</Label>
									<div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-1 text-sm">
										{result.suggestedPrompts.map((p, i) => (
											<div key={p.prompt} className="flex items-start gap-2 py-1 border-b last:border-0">
												<span className="text-muted-foreground w-6 flex-shrink-0">{i + 1}.</span>
												<span className="flex-1">{p.prompt}</span>
												<div className="flex flex-wrap gap-1 flex-shrink-0">
													{p.tags.map((tag) => (
														<Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
															{tag}
														</Badge>
													))}
												</div>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<Label className="text-muted-foreground">{label}</Label>
			<p className="font-medium">{value.toLocaleString(UI_LOCALE)}</p>
		</div>
	);
}

function TagSection({ title, items }: { title: string; items: string[] }) {
	return (
		<div className="space-y-1">
			<Label className="text-muted-foreground">{title}</Label>
			<div className="flex flex-wrap gap-1">
				{items.map((it) => (
					<Badge key={it} variant="secondary">
						{it}
					</Badge>
				))}
			</div>
		</div>
	);
}

export const Route = createFileRoute("/_authed/admin/tools")({
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: `${t("reports.tools")} · ${appName}` },
				{ name: "description", content: t("reports.brandOnboardingAnalysis") },
			],
		};
	},
	component: ToolsPage,
});

function ToolsPage() {
	return (
		<div className="space-y-8">
			<div className="space-y-2">
				<h1 className="text-3xl font-bold tracking-tight">{t("reports.tools")}</h1>
				<p className="text-muted-foreground">
					{t("reports.runTheOnboardingAnalysisForAnyBrandWithoutCreatingItSamePipeline")}
					<code className="mx-1 rounded bg-muted px-1">POST /api/v1/tools/analyze</code>.
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Sparkles className="h-5 w-5" />
							{t("reports.brandAnalysis")}
						</CardTitle>
						<CardDescription>
							{t("reports.analyzeAWebsiteToDiscoverItsCompetitorsAdditionalBrandDomainsAliasesAnd")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<AnalyzeBrandDialog />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
