import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { computeSystemTags } from "@workspace/lib/tag-utils";
import { Button } from "@workspace/ui/components/button";
import { Save } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { type EditablePrompt, PromptsListEditor } from "@/components/prompts-list-editor";
import { brandKeys } from "@/hooks/use-brands";
import { buildPromptEdits } from "@/lib/prompt-edits";
import { APP_LANGUAGE, t } from "@/i18n";
import { settingsError } from "@/i18n/settings-labels";
import { trackEvent } from "@/lib/posthog";
import { updatePromptsFn } from "@/server/prompts";
import { PromptLanguageSuggestions } from "./prompt-language-suggestions";

interface Prompt {
	id: string;
	brandId: string;
	value: string;
	enabled: boolean;
	tags?: string[];
	systemTags?: string[];
	createdAt: Date;
}

interface PromptsEditorProps {
	initialPrompts: Prompt[];
	brandId: string;
	brandName?: string;
	brandWebsite?: string;
	pageTitle: string;
	pageDescription: string;
}

export function PromptsEditor({
	initialPrompts,
	brandId,
	brandName,
	brandWebsite,
	pageTitle,
	pageDescription,
}: PromptsEditorProps) {
	const [prompts, setPrompts] = useState<EditablePrompt[]>(() =>
		initialPrompts.map((p) => ({
			id: p.id,
			_key: p.id,
			value: p.value,
			enabled: p.enabled,
			tags: p.tags || [],
			systemTags: p.systemTags || [],
		})),
	);
	const [isLoading, setIsLoading] = useState(false);
	const saveInProgress = useRef(false);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const router = useRouter();
	const deletedCount = initialPrompts.filter((prompt) => !prompts.some((draft) => draft.id === prompt.id)).length;
	const routeContext = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const isReadOnly = routeContext.clientConfig?.features.readOnly;

	const savePrompts = async () => {
		if (saveInProgress.current) {
			console.warn("Save already in progress, ignoring duplicate request");
			return;
		}

		if (prompts.some((prompt) => prompt.id && !prompt.value.trim())) {
			alert(t("settings.promptTextRequired"));
			return;
		}

		saveInProgress.current = true;
		setIsLoading(true);
		try {
			const edits = buildPromptEdits(brandId, initialPrompts, prompts);
			if (
				edits.deletedPromptIds.length &&
				!window.confirm(
					`${edits.deletedPromptIds.length}${APP_LANGUAGE === "en" ? " prompt(s)" : "件のプロンプト"}\n${t("settings.confirmPromptDeletion")}`,
				)
			)
				return;

			await updatePromptsFn({ data: edits });
			trackEvent("prompts_updated", {
				added: edits.prompts.filter((prompt) => !prompt.id).length,
				edited: edits.prompts.filter((prompt) => prompt.id).length,
				deleted: edits.deletedPromptIds.length,
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: brandKeys.all }),
				...["prompts-summary", "batch-chart-data", "promptChartData"].map((key) =>
					queryClient.invalidateQueries({ queryKey: [key, brandId] }),
				),
			]);
			await router.invalidate();
			await navigate({ to: `/app/${brandId}/visibility` });
		} catch (error) {
			console.error("Error saving prompts:", error);
			alert(settingsError(error, t("settings.failedToSave")));
		} finally {
			setIsLoading(false);
			saveInProgress.current = false;
		}
	};

	const handleComputeSystemTags = useCallback(
		(text: string) => {
			if (!brandName || !brandWebsite) return [];
			return computeSystemTags(text, brandName, brandWebsite);
		},
		[brandName, brandWebsite],
	);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">{pageTitle}</h1>
					<p className="text-muted-foreground">{pageDescription}</p>
				</div>
			</div>

			<fieldset disabled={isLoading || isReadOnly} className="space-y-6 min-w-0" aria-label={pageTitle}>
				<PromptLanguageSuggestions prompts={prompts} onAdopt={setPrompts} disabled={isLoading || isReadOnly} />
				<PromptsListEditor prompts={prompts} onChange={setPrompts} computeSystemTags={handleComputeSystemTags} />
			</fieldset>

			{deletedCount > 0 && (
				<p role="status" className="text-sm text-muted-foreground">
					{deletedCount}
					{APP_LANGUAGE === "en" ? " prompt(s): " : "件: "}
					{t("settings.pendingPromptDeletion")}
				</p>
			)}
			<div className="flex gap-2 items-center">
				<Button
					onClick={savePrompts}
					disabled={isLoading || isReadOnly}
					size="sm"
					className="flex items-center gap-2 cursor-pointer"
				>
					{isLoading ? (
						t("settings.saving")
					) : (
						<>
							<Save className="h-4 w-4" />
							{t("settings.savePrompts")}
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
