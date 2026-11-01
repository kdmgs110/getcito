import { IconCircleCheck, IconCircleX, IconInfoCircle } from "@tabler/icons-react";
import type { ModelConfig } from "@workspace/config/scrape-targets";
import { measurementSurface, measurementTargetKey, measurementTargetLabel } from "@workspace/lib/measurement";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { createTranslator, t } from "@/i18n";

export const llmSettingsLabels = createTranslator({
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
	difference: {
		en: "AI Overview is a summary in regular Google search results. AI Mode is a dedicated conversational search experience. Answers and cited sites can differ, so they are measured separately.",
		ja: "AI Overviewは通常のGoogle検索結果に出る要約、AI Modeは対話しながら調べる専用の検索画面です。回答や引用元が異なる場合があるため、別々に計測します。",
	},
	measures: { en: "What you can measure", ja: "確認できること" },
	configuration: { en: "Acquisition settings", ja: "取得設定" },
});

const descriptions = createTranslator({
	"chatgpt_web.summary": {
		en: "Tracks answers shown in the ChatGPT web interface.",
		ja: "ChatGPTのWeb画面で表示される回答を計測します。",
	},
	"chatgpt_web.purpose": {
		en: "See how your brand is described and which sites the answer cites. Some answers do not use web search.",
		ja: "自社がどう紹介され、どのサイトが引用されるかを確認できます。Web検索を使わずに回答する場合もあります。",
	},
	"google_ai_overview.summary": {
		en: "Tracks AI Overviews shown within regular Google search results.",
		ja: "通常のGoogle検索結果に表示される「AIによる概要」を計測します。",
	},
	"google_ai_overview.purpose": {
		en: "See whether your brand or site appears in the AI summary. An overview is not shown for every search.",
		ja: "検索結果のAI要約に、自社やサイトが登場・引用されるかを確認できます。検索語によっては概要が表示されません。",
	},
	"google_ai_mode.summary": {
		en: "Tracks Google's dedicated AI Mode search experience, where people can ask follow-up questions.",
		ja: "追加質問をしながら調べられる、Google検索の専用画面「AIモード」を計測します。",
	},
	"google_ai_mode.purpose": {
		en: "See how your brand is described and cited for complex questions and comparisons. Results may differ from AI Overviews.",
		ja: "複雑な質問や比較で、自社がどう紹介・引用されるかを確認できます。AI Overviewとは結果が異なる場合があります。",
	},
	"llm_api.summary": {
		en: "Tracks answers generated through a model API.",
		ja: "モデルのAPIを通じて生成された回答を計測します。",
	},
	"llm_api.purpose": {
		en: "See how the model answers your prompt. Results can differ from the consumer web product, even for the same model family.",
		ja: "指定した質問に対するモデルの回答を確認できます。同じモデル系列でも、一般向けWeb画面の回答とは異なる場合があります。",
	},
	"unknown.summary": {
		en: "Tracks answers collected by this configured provider.",
		ja: "設定された取得元からの回答を計測します。",
	},
	"unknown.purpose": {
		en: "The answer surface and available evidence depend on the provider. Review the acquisition settings below.",
		ja: "対象画面や取得できる情報は取得元によって異なります。下の取得設定も確認してください。",
	},
});

interface LlmSettingsViewProps {
	renderModelIcon: (model: string, className: string) => React.ReactNode;
	configs: ModelConfig[];
	isLoading: boolean;
	hasBrand: boolean;
	selected: string[];
	saving: boolean;
	readOnly: boolean;
	message: string;
	onSave: () => void;
	onToggleTarget: (key: string, checked: boolean) => void;
}

export function LlmSettingsView({
	renderModelIcon,
	configs,
	isLoading,
	hasBrand,
	selected,
	saving,
	readOnly,
	message,
	onSave,
	onToggleTarget,
}: LlmSettingsViewProps) {
	return (
		<div className="space-y-6 max-w-6xl">
			<div>
				<h1 className="text-3xl font-bold">{t("settings.llms")}</h1>
				<p className="text-muted-foreground">{t("settings.yourPromptsAreEvaluatedAgainstTheseAiModelsTo")}</p>
			</div>

			<div className="space-y-2">
				<h2 className="font-medium">{llmSettingsLabels("choose")}</h2>
				<p className="text-sm text-muted-foreground">{llmSettingsLabels("help")}</p>
				{!isLoading && selected.length === 0 && (
					<p className="text-sm text-muted-foreground">{llmSettingsLabels("none")}</p>
				)}
				<Button onClick={onSave} disabled={saving || readOnly || !hasBrand} size="sm">
					{saving ? llmSettingsLabels("saving") : llmSettingsLabels("save")}
				</Button>
				{message && (
					<p role="status" className="text-sm">
						{message}
					</p>
				)}
			</div>
			<div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
				<IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<p>{llmSettingsLabels("difference")}</p>
			</div>

			{isLoading && !hasBrand ? (
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
								{renderModelIcon(config.model, "h-6 w-6")}
								<label
									htmlFor={`target-${measurementTargetKey(config)}`}
									className="flex items-center gap-2 text-sm font-medium cursor-pointer"
								>
									<Checkbox
										id={`target-${measurementTargetKey(config)}`}
										checked={selected.includes(measurementTargetKey(config))}
										disabled={saving || readOnly}
										onCheckedChange={(checked) => onToggleTarget(measurementTargetKey(config), checked === true)}
									/>
									{measurementTargetLabel(config.model, config.provider)}
								</label>
							</CardHeader>
							<CardContent className="space-y-4 pt-4">
								<div className="space-y-3 text-sm">
									<p className="text-xs text-muted-foreground">
										{t("settings.provider")}: {config.provider}
									</p>
									<p>{descriptions(`${measurementSurface(config.model, config.provider)}.summary`)}</p>
									<div className="space-y-1.5 rounded-md bg-muted/40 p-3">
										<p className="text-xs font-medium">{llmSettingsLabels("measures")}</p>
										<p className="leading-relaxed text-muted-foreground">
											{descriptions(`${measurementSurface(config.model, config.provider)}.purpose`)}
										</p>
									</div>
								</div>
								<details className="border-t pt-3">
									<summary className="cursor-pointer text-xs font-medium text-muted-foreground">
										{llmSettingsLabels("configuration")}
									</summary>
									<div className="divide-y pt-2 text-sm">
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
											<span className="sr-only">
												{config.webSearch ? t("settings.enabled") : t("settings.disabled")}
											</span>
										</ConfigRow>
									</div>
								</details>
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
