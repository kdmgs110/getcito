import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookmarkPlus, Copy } from "lucide-react";
import {
	aggregateTrafficPoints,
	AI_CLASSIFICATION_VERSION,
	ANALYTICS_MEASUREMENT_VERSION,
	type AnalyticsMeasurementMode,
	FILTER_SCHEMA_VERSION,
	type TrafficGrain,
	type TrafficRequest,
	type SavedTrafficView,
} from "@workspace/lib/analytics";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Button } from "@workspace/ui/components/button";
import { t } from "@/i18n";
import { getTrafficPageDetailFn } from "@/server/traffic";
import { TrafficChart, TrafficKpis, TrafficPeriodTable } from "./traffic-chart";
import { TrafficError, TrafficLoading } from "./shared";
import { QualityNotices } from "./quality-notices";
import { MeasurementNotice, trafficMeasurementLabels } from "./traffic-measurement";
export function PageTrafficDetail({
	request,
	path,
	hostname,
	timeZone,
	initialGrain,
	canManage,
	onClose,
	onRegister,
	registeredView,
	onOpenRegistered,
	returnFocus,
	connectionKey,
	measurementMode,
}: {
	request: TrafficRequest;
	path: string;
	hostname: string;
	timeZone: string;
	initialGrain: TrafficGrain;
	canManage: boolean;
	onClose: () => void;
	onRegister: () => void;
	registeredView?: SavedTrafficView;
	onOpenRegistered: (id: string) => void;
	returnFocus: HTMLElement | null;
	connectionKey: string;
	measurementMode: AnalyticsMeasurementMode;
}) {
	const measurement = trafficMeasurementLabels(measurementMode);
	const [grain, setGrain] = useState(initialGrain);
	const [chart, setChart] = useState<"total" | "sources">("total");
	const [copied, setCopied] = useState(false);
	const query = useQuery({
		queryKey: [
			"traffic-detail",
			connectionKey,
			measurementMode,
			ANALYTICS_MEASUREMENT_VERSION,
			AI_CLASSIFICATION_VERSION,
			FILTER_SCHEMA_VERSION,
			request,
			path,
		],
		queryFn: () => getTrafficPageDetailFn({ data: { ...request, path } }),
		staleTime: 30 * 60000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				onCloseAutoFocus={(event) => {
					if (returnFocus?.isConnected) {
						event.preventDefault();
						returnFocus.focus();
					}
				}}
				className="w-full gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:max-w-3xl"
			>
				<SheetHeader className="border-b p-5 pr-12">
					<SheetTitle className="text-balance text-xl">{measurement.pageDetail}</SheetTitle>
					<SheetDescription>{t("traffic.inheritedRange")}</SheetDescription>
				</SheetHeader>
				<div className="space-y-4 p-4 sm:p-5">
					<MeasurementNotice mode={measurementMode} />
					<div className="rounded-xl border p-4">
						<p className="mb-2 text-sm font-medium">{measurement.targetPages}</p>
						<div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
							<code className="min-w-0 flex-1 break-all text-sm">{path}</code>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("traffic.copyPath")}
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(path);
										setCopied(true);
									} catch {
										setCopied(false);
									}
								}}
							>
								<Copy className="size-4" />
							</Button>
						</div>
						<div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
							<span>{hostname}</span>
							<span className="rounded border px-2">{t("traffic.exact")}</span>
							{copied && <span role="status">{t("traffic.copied")}</span>}
						</div>
						<p className="mt-3 text-xs tabular-nums">
							{request.from} – {request.to} · {timeZone}
						</p>
						{canManage && (
							<Button variant="outline" size="sm" className="mt-3" onClick={onRegister}>
								<BookmarkPlus className="size-4" />
								{t("traffic.registerPage")}
							</Button>
						)}
					</div>
					{registeredView && (
						<div
							role="status"
							className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
						>
							<span>{t("traffic.savedSuccess")}</span>
							<Button size="sm" variant="outline" onClick={() => onOpenRegistered(registeredView.id)}>
								{t("traffic.openSaved")}
							</Button>
						</div>
					)}
					{query.isPending && <TrafficLoading />}
					{query.isError && <TrafficError error={query.error} retry={() => query.refetch()} />}
					{query.data && (
						<>
							<TrafficKpis totals={query.data.totals} />
							<QualityNotices warnings={query.data.warnings} />
							<TrafficChart
								points={aggregateTrafficPoints(query.data.points, grain, request.from, request.to)}
								chart={chart}
								onChartChange={setChart}
							/>
							<TrafficPeriodTable
								data={query.data}
								grain={grain}
								from={request.from}
								to={request.to}
								onGrainChange={setGrain}
							/>
						</>
					)}
					<p className="text-pretty text-xs leading-relaxed text-muted-foreground">{measurement.measurementNote}</p>
					<div className="flex justify-end">
						<Button variant="outline" onClick={onClose}>
							{t("traffic.close")}
						</Button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
