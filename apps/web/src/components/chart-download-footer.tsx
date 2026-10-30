import { t } from "@/i18n";

import { Download } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { ChartFooter } from "./chart-footer";

interface ChartDownloadFooterProps {
	onDownload: () => void;
	isDownloading: boolean;
}

export function ChartDownloadFooter({ onDownload, isDownloading }: ChartDownloadFooterProps) {
	return (
		<div className="print:hidden">
			<ChartFooter>
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
			</ChartFooter>
		</div>
	);
}
