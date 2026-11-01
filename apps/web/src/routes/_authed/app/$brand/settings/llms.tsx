import { IconCircleCheck, IconCircleX, IconInfoCircle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
/**
 * /app/$brand/settings/llms - LLM configuration page
 *
 * Lists the AI models this brand is tracked against, data-driven from the
 * deployment's `SCRAPE_TARGETS` + `brand.enabledModels`. Each card renders
 * from `brand.effectiveModelConfigs` rather than a hardcoded model list so
 * any deployment-configured model shows up automatically.
 */
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { measurementTargetKey, measurementTargetLabel } from "@workspace/lib/measurement";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useEffect, useState } from "react";
import { iconForModel } from "@/components/filter-bar";
import { useBrand } from "@/hooks/use-brands";
import { createTranslator, t } from "@/i18n";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { updateBrandMeasurementTargetsFn } from "@/server/brands";

export const Route = createFileRoute("/_authed/app/$brand/settings/llms")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("settings.llms"), { appName, brandName }) },
				{ name: "description", content: t("settings.viewTrackedAiModelsAndConfiguration") },
			],
		};
	},
	component: LlmsSettingsPage,
});

const labels = createTranslator({
	choose: { en: "Choose measurement targets", ja: "計測対象を選択" },
	help: {
		en: "Applies to future scheduled runs. Each selected target makes a separate provider request; past results remain available.",
		ja: "次回以降の定期計測に適用します。選択した対象ごとに取得リクエストが発生します。過去の結果は保持されます。",
	},
	save: { en: "Save targets", ja: "計測対象を保存" },
	saving: { en: "Saving…", ja: "保存中…" },
	saved: { en: "Measurement targets saved.", ja: "計測対象を保存しました。" },
	failed: {
		en: "Could not save measurement targets. Please retry.",
		ja: "計測対象を保存できませんでした。再試行してください。",
	},
	none: {
		en: "No selected targets: scheduled prompts will not call any provider.",
		ja: "対象を選択しない場合、定期計測の取得リクエストは実行されません。",
	},
});

function LlmsSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const configs = brand?.availableModelConfigs ?? brand?.effectiveModelConfigs ?? [];
	const queryClient = useQueryClient();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const readOnly = context.clientConfig?.features.readOnly ?? false;
	const selectedSignature = (
		brand?.enabledTargets ??
		brand?.effectiveModelConfigs?.map(measurementTargetKey) ??
		[]
	).join(",");
	const [selected, setSelected] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		if (!brand?.id) return;
		setSelected(selectedSignature ? selectedSignature.split(",") : []);
		setMessage("");
	}, [brand?.id, selectedSignature]);
	const save = async () => {
		if (!brand || saving || readOnly) return;
		setSaving(true);
		setMessage("");
		try {
			await updateBrandMeasurementTargetsFn({ data: { brandId: brand.id, targetKeys: selected } });
			await revalidate();
			await queryClient.invalidateQueries({ queryKey: ["brands"] });
			setMessage(labels("saved"));
		} catch {
			setMessage(labels("failed"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-6 max-w-6xl">
			<div>
				<h1 className="text-3xl font-bold">{t("settings.llms")}</h1>
				<p className="text-muted-foreground">{t("settings.yourPromptsAreEvaluatedAgainstTheseAiModelsTo")}</p>
			</div>

			<div className="space-y-2">
				<h2 className="font-medium">{labels("choose")}</h2>
				<p className="text-sm text-muted-foreground">{labels("help")}</p>
				{!isLoading && selected.length === 0 && <p className="text-sm text-muted-foreground">{labels("none")}</p>}
				<Button onClick={save} disabled={saving || readOnly || !brand} size="sm">
					{saving ? labels("saving") : labels("save")}
				</Button>
				{message && (
					<p role="status" className="text-sm">
						{message}
					</p>
				)}
			</div>

			{isLoading && !brand ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Card key={i} className="h-full">
							<CardHeader className="py-2 border-b">
								<Skeleton className="h-6 w-6 rounded" />
							</CardHeader>
							<CardContent className="pt-2 space-y-2">
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-4 w-2/3" />
							</CardContent>
						</Card>
					))}
				</div>
			) : configs.length === 0 ? (
				<Card>
					<CardContent className="pt-6 text-sm text-muted-foreground">{t("settings.modelsMissing")}</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{configs.map((config) => (
						<Card key={measurementTargetKey(config)} className="h-full">
							<CardHeader className="py-2 border-b flex-row items-center gap-3">
								{iconForModel(config.model, "h-6 w-6")}
								<label
									htmlFor={`target-${measurementTargetKey(config)}`}
									className="flex items-center gap-2 text-sm font-medium cursor-pointer"
								>
									<Checkbox
										id={`target-${measurementTargetKey(config)}`}
										checked={selected.includes(measurementTargetKey(config))}
										disabled={saving || readOnly}
										onCheckedChange={(checked) => {
											const key = measurementTargetKey(config);
											setSelected((old) =>
												checked === true ? [...new Set([...old, key])] : old.filter((value) => value !== key),
											);
											setMessage("");
										}}
									/>
									{measurementTargetLabel(config.model, config.provider)}
								</label>
							</CardHeader>
							<CardContent className="pt-2">
								<div className="divide-y text-sm">
									<ConfigRow label={t("settings.model")} tooltip={t("settings.whichAiModelThisCardCovers")}>
										<span className="font-mono text-xs text-foreground">{config.model}</span>
									</ConfigRow>
									<ConfigRow
										label={t("settings.provider")}
										tooltip={t("settings.howThisDeploymentReachesTheModelDirectApiA")}
									>
										<span className="font-mono text-xs text-foreground">{config.provider}</span>
									</ConfigRow>
									<ConfigRow
										label={t("settings.version")}
										tooltip={t("settings.exactUpstreamModelVersionRequestedFromTheProvider")}
									>
										<span className="font-mono text-xs text-foreground">{config.version ?? "—"}</span>
									</ConfigRow>
									<ConfigRow label={t("settings.webSearch")} tooltip={t("settings.isWebSearchUsedToAnswerPrompts")}>
										{config.webSearch ? (
											<IconCircleCheck className="h-4 w-4 text-emerald-600" />
										) : (
											<IconCircleX className="h-4 w-4 text-muted-foreground" />
										)}
										<span className="sr-only">{config.webSearch ? t("settings.enabled") : t("settings.disabled")}</span>
									</ConfigRow>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}

function ConfigRow({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between py-2">
			<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
				<span>{label}</span>
				{tooltip && (
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-xs font-normal">{tooltip}</TooltipContent>
					</Tooltip>
				)}
			</div>
			<div className="flex items-center gap-2">{children}</div>
		</div>
	);
}
