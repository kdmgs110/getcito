import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/i18n";
export function TrafficCard({
	title,
	action,
	children,
	className = "",
}: {
	title?: string;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={cn("rounded-xl border bg-card p-4 sm:p-5", className)}>
			{(title || action) && (
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					{title && <h2 className="text-balance font-semibold">{title}</h2>}
					{action}
				</div>
			)}
			{children}
		</section>
	);
}
export function TrafficLoading() {
	return (
		<div role="status" aria-label={t("traffic.loading")} aria-busy="true" className="space-y-4">
			<div className="grid grid-cols-3 gap-3">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>
			<Skeleton className="h-72 w-full" />
		</div>
	);
}
const errorKeys = {
	CONVERSION_GOAL_NOT_FOUND: "conversions.goalMissing",
	CONVERSION_GOAL_DISABLED: "conversions.goalDisabled",
	CONVERSION_EVENT_MISSING: "conversions.eventMissing",
	CONVERSION_GOAL_CONFLICT: "conversions.conflict",
	CONVERSION_GOAL_DUPLICATE: "conversions.duplicate",
	CONVERSION_GOAL_LIMIT: "conversions.limit",
	ANALYTICS_UNSUPPORTED_SITE: "traffic.unsupportedSite",
	ANALYTICS_REPORT_TOO_LARGE: "traffic.reportLarge",
	ANALYTICS_QUOTA: "traffic.quota",
	TRAFFIC_VIEW_INVALID_NAME: "traffic.nameInvalid",
	TRAFFIC_VIEW_LIMIT: "traffic.viewLimit",
	TRAFFIC_INVALID_REQUEST: "traffic.conditionInvalid",
	TRAFFIC_VIEW_INCOMPATIBLE: "traffic.conditionInvalid",
	ANALYTICS_NOT_CONFIGURED: "traffic.configRequired",
	ANALYTICS_RECONNECT_REQUIRED: "traffic.reauth",
	TRAFFIC_VIEW_CONFLICT: "traffic.conflict",
	TRAFFIC_VIEW_DUPLICATE_NAME: "traffic.duplicateName",
	TRAFFIC_VIEW_NOT_FOUND: "traffic.invalidView",
	TRAFFIC_INVALID_SITE: "traffic.invalidSite",
	ANALYTICS_FORBIDDEN: "traffic.forbidden",
	ANALYTICS_CONNECTION_CHANGED: "traffic.connectionChanged",
} as const;
export function trafficError(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	const key = Object.keys(errorKeys).find((code) => message.includes(code)) as keyof typeof errorKeys | undefined;
	return key ? t(errorKeys[key]) : t("traffic.failed");
}
export function TrafficError({ error, retry }: { error?: unknown; retry?: () => void }) {
	return (
		<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
			<p className="flex items-center gap-2 font-medium">
				<AlertCircle className="size-4" />
				{t("traffic.error")}
			</p>
			<p className="mt-2 text-pretty">{trafficError(error)}</p>
			{retry && (
				<Button variant="outline" size="sm" onClick={retry} className="mt-3">
					{t("traffic.retry")}
				</Button>
			)}
		</div>
	);
}
