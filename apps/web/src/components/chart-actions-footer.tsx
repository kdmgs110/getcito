import { t } from "@/i18n";
import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { getOptimizeButtonForMode } from "@workspace/deployment/client";
import { Button } from "@workspace/ui/components/button";
import { Download } from "lucide-react";
import { useCallback } from "react";
import { APP_TIMEZONE } from "@/lib/app-locale";
import type { LookbackPeriod } from "@/lib/chart-utils";
import { getPromptWebQueryFn } from "@/server/prompts";
import { ChartFooter } from "./chart-footer";
import { HistoryButton } from "./history-button";

interface ChartActionsFooterProps {
	promptId?: string;
	promptName?: string;
	brandId?: string;

	// For export
	onDownload?: () => void;
	isDownloading?: boolean;

	// For optimization
	/** Current model filter ("all" = no filter). */
	selectedModel?: string;
	/** Concrete model ids this brand runs — no "all" sentinel. */
	availableModels?: string[];
	lookback?: LookbackPeriod;
}

export function ChartActionsFooter({
	promptId,
	promptName,
	brandId,
	onDownload,
	isDownloading = false,
	selectedModel = "all",
	availableModels = [],
	lookback = "1m",
}: ChartActionsFooterProps) {
	const isSinglePrompt = Boolean(promptId && brandId);

	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const mode = context.clientConfig?.mode ?? "local";
	const showOptimizeButton = context.clientConfig?.features.showOptimizeButton ?? false;
	const { parentName, optimizationUrlTemplate } = context.clientConfig?.branding ?? {};
	const OptimizeButton = getOptimizeButtonForMode(mode);

	const fetchWebQuery = useCallback(
		async (pId: string, lb: string, model?: string) => {
			if (!brandId) throw new Error("No brand ID");
			return getPromptWebQueryFn({
				data: {
					brandId,
					promptId: pId,
					lookback: lb,
					model,
					timezone: APP_TIMEZONE,
				},
			});
		},
		[brandId],
	);

	if (!isSinglePrompt) {
		return null;
	}

	return (
		<ChartFooter>
			<div className="flex flex-wrap items-center justify-between gap-2 w-full">
				<div className="flex flex-wrap items-center gap-2">
					<HistoryButton promptName={promptName} promptId={promptId} brandId={brandId} model={selectedModel} />
					{onDownload && (
						<Button
							onClick={onDownload}
							disabled={isDownloading}
							size="sm"
							variant="secondary"
							className="text-xs cursor-pointer h-6 flex items-center px-2"
							title={t("core.downloadChartAsPNG")}
						>
							<Download className="size-3 mr-0.5" />
							<span className="text-xs font-normal">{isDownloading ? t("core.exporting") : t("core.exportPNG")}</span>
						</Button>
					)}
				</div>
				{showOptimizeButton && (
					<OptimizeButton
						promptName={promptName}
						promptId={promptId}
						brandId={brandId}
						selectedModel={selectedModel}
						availableModels={availableModels}
						lookback={lookback}
						parentName={parentName ?? ""}
						optimizationUrlTemplate={optimizationUrlTemplate ?? ""}
						fetchWebQuery={fetchWebQuery}
					/>
				)}
			</div>
		</ChartFooter>
	);
}
