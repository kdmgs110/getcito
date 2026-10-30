import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
	AI_PROVIDERS,
	aggregateTrafficPoints,
	type AIProvider,
	type TrafficGrain,
	type TrafficOverview,
	type TrafficPoint,
	type TrafficTotals,
} from "@workspace/lib/analytics";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { formatNumber, t, UI_LOCALE } from "@/i18n";
import { ratio } from "./traffic-state";
import { TrafficCard } from "./shared";
import { useTrafficMeasurement, trafficMeasurementLabels } from "./traffic-measurement";
import type { AnalyticsMeasurementMode } from "@workspace/lib/analytics";
export const sourceColors: Record<AIProvider | "ai", string> = {
	ai: "#18181b",
	chatgpt: "#059669",
	perplexity: "#0d9488",
	gemini: "#3b82f6",
	claude: "#d97706",
	copilot: "#7c3aed",
	other: "#9ca3af",
};
export const sourceLabels = (mode?: AnalyticsMeasurementMode): Record<AIProvider | "ai", string> => ({
	ai: trafficMeasurementLabels(mode).aiTotal,
	chatgpt: "ChatGPT",
	perplexity: "Perplexity",
	gemini: "Gemini",
	claude: "Claude",
	copilot: "Copilot",
	other: t("traffic.other"),
});
export function formatRatio(ai: number, total: number) {
	const value = ratio(ai, total);
	return value === null ? "—" : `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
export function dateLabel(date: string) {
	return new Intl.DateTimeFormat(UI_LOCALE, { month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(
		new Date(`${date}T00:00:00Z`),
	);
}
export function GrainToggle({ value, onChange }: { value: TrafficGrain; onChange: (v: TrafficGrain) => void }) {
	return (
		<Tabs value={value} onValueChange={(v) => onChange(v as TrafficGrain)}>
			<TabsList aria-label={t("traffic.period")}>
				<TabsTrigger value="day">{t("traffic.daily")}</TabsTrigger>
				<TabsTrigger value="week">{t("traffic.weekly")}</TabsTrigger>
				<TabsTrigger value="month">{t("traffic.monthly")}</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}
export function TrafficKpis({ totals }: { totals: TrafficTotals }) {
	const measurement = useTrafficMeasurement();
	return (
		<div className="grid gap-3 sm:grid-cols-3">
			{[
				{ label: measurement.ai, value: formatNumber(totals.ai), suffix: measurement.sessions },
				{ label: measurement.total, value: formatNumber(totals.total), suffix: measurement.sessions },
				{ label: measurement.ratio, value: formatRatio(totals.ai, totals.total) },
			].map((metric) => (
				<div key={metric.label} className="rounded-xl border bg-card p-5">
					<p className="text-sm font-medium">{metric.label}</p>
					<p className="mt-2 flex flex-wrap items-baseline gap-2">
						<span className="text-3xl font-semibold tabular-nums">{metric.value}</span>
						{metric.suffix && <span className="text-xs text-muted-foreground">{metric.suffix}</span>}
					</p>
				</div>
			))}
		</div>
	);
}
export function TrafficChart({
	points,
	chart,
	onChartChange,
}: {
	points: TrafficPoint[];
	chart: "total" | "sources";
	onChartChange: (v: "total" | "sources") => void;
}) {
	const [hidden, setHidden] = useState<string[]>([]);
	const measurement = useTrafficMeasurement();
	const labels = sourceLabels(measurement.mode);
	const series: (AIProvider | "ai")[] = chart === "sources" ? ["ai", ...AI_PROVIDERS] : ["ai"];
	return (
		<TrafficCard
			title={measurement.trend}
			action={
				<Tabs value={chart} onValueChange={(v) => onChartChange(v as "total" | "sources")}>
					<TabsList aria-label={t("traffic.composition")}>
						<TabsTrigger value="total">{measurement.aiTotal}</TabsTrigger>
						<TabsTrigger value="sources">{t("traffic.aiSources")}</TabsTrigger>
					</TabsList>
				</Tabs>
			}
		>
			<p className="mb-2 text-xs text-muted-foreground">{measurement.sessions}</p>
			<div className="h-64 w-full" role="img" aria-label={measurement.trend}>
				<ResponsiveContainer width="100%" height="100%">
					<LineChart accessibilityLayer data={points} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
						<XAxis
							dataKey="date"
							tickFormatter={dateLabel}
							minTickGap={40}
							tickLine={false}
							axisLine={false}
							fontSize={11}
						/>
						<YAxis
							width={45}
							allowDecimals={false}
							tickLine={false}
							axisLine={false}
							fontSize={11}
							tickFormatter={(n) => formatNumber(n)}
						/>
						<Tooltip
							labelFormatter={(label) => String(label)}
							formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
							contentStyle={{ borderRadius: 8, borderColor: "var(--border)", fontSize: 12 }}
						/>
						{series.map((key) => (
							<Line
								key={key}
								dataKey={key}
								name={labels[key]}
								stroke={sourceColors[key]}
								strokeWidth={key === "ai" ? 2 : 1.7}
								dot={points.length === 1 ? { r: 4, fill: sourceColors[key], strokeWidth: 0 } : false}
								activeDot={{ r: 4 }}
								isAnimationActive={false}
								hide={hidden.includes(key)}
							/>
						))}
					</LineChart>
				</ResponsiveContainer>
			</div>
			<div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2">
				{series.map((key) => (
					<button
						type="button"
						key={key}
						aria-pressed={!hidden.includes(key)}
						className={cn(
							"flex items-center gap-1.5 rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-ring",
							hidden.includes(key) && "opacity-40",
						)}
						onClick={() => setHidden((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]))}
					>
						<span className="size-2.5 rounded-full" style={{ backgroundColor: sourceColors[key] }} />
						{labels[key]}
					</button>
				))}
			</div>
		</TrafficCard>
	);
}
function partial(date: string, grain: TrafficGrain, from: string, to: string) {
	if (grain === "day") return false;
	const start = new Date(`${date}T00:00:00Z`);
	const end = new Date(start);
	if (grain === "week") end.setUTCDate(end.getUTCDate() + 6);
	else {
		end.setUTCMonth(end.getUTCMonth() + 1);
		end.setUTCDate(0);
	}
	return date < from || end.toISOString().slice(0, 10) > to;
}
export function TrafficPeriodTable({
	data,
	grain,
	from,
	to,
	onGrainChange,
}: {
	data: TrafficOverview;
	grain: TrafficGrain;
	from: string;
	to: string;
	onGrainChange: (v: TrafficGrain) => void;
}) {
	const rows = aggregateTrafficPoints(data.points, grain, from, to);
	const measurement = useTrafficMeasurement();
	const labels = sourceLabels(measurement.mode);
	const keys = ["ai", ...AI_PROVIDERS] as const;
	return (
		<TrafficCard title={measurement.periodTable} action={<GrainToggle value={grain} onChange={onGrainChange} />}>
			<div className="max-h-96 overflow-auto">
				<table className="w-full text-sm tabular-nums">
					<thead className="sticky top-0 bg-card text-xs text-muted-foreground">
						<tr>
							<th className="whitespace-nowrap border-b px-2 py-3 text-left font-medium">{t("traffic.date")}</th>
							{keys.map((key) => (
								<th key={key} className="whitespace-nowrap border-b px-2 py-3 text-right font-medium">
									{labels[key]}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{[...rows].reverse().map((row) => (
							<tr key={row.date}>
								<th scope="row" className="whitespace-nowrap border-b px-2 py-2 text-left font-normal">
									{grain === "month" ? row.date.slice(0, 7) : row.date}
									{partial(row.date, grain, from, to) && (
										<span className="ml-2 text-xs text-muted-foreground">{t("traffic.partialPeriod")}</span>
									)}
								</th>
								{keys.map((key) => (
									<td key={key} className="border-b px-2 py-2 text-right">
										{formatNumber(row[key])}
									</td>
								))}
							</tr>
						))}
					</tbody>
					<tfoot className="sticky bottom-0 bg-card font-semibold">
						<tr>
							<th className="whitespace-nowrap border-t px-2 py-3 text-left">{t("traffic.periodTotal")}</th>
							{keys.map((key) => (
								<td key={key} className="border-t px-2 py-3 text-right">
									{formatNumber(data.totals[key])}
								</td>
							))}
						</tr>
					</tfoot>
				</table>
			</div>
		</TrafficCard>
	);
}
export function Composition({ totals }: { totals: TrafficTotals }) {
	const measurement = useTrafficMeasurement();
	const labels = sourceLabels(measurement.mode);
	const description = AI_PROVIDERS.map((key) => `${labels[key]} ${formatNumber(totals[key])}`).join(", ");
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="block w-36 rounded py-2 focus-visible:outline-2 focus-visible:outline-ring"
					aria-label={`${t("traffic.composition")}: ${description}`}
					title={description}
				>
					<span className="flex h-3 overflow-hidden rounded-sm bg-muted">
						{AI_PROVIDERS.map((key) => (
							<span
								key={key}
								style={{
									width: `${totals.ai ? (totals[key] / totals.ai) * 100 : 0}%`,
									backgroundColor: sourceColors[key],
								}}
							/>
						))}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-64">
				<p className="mb-3 text-sm font-medium">{t("traffic.composition")}</p>
				<dl className="space-y-2 text-xs">
					{AI_PROVIDERS.map((key) => (
						<div key={key} className="flex items-center justify-between gap-3">
							<dt className="flex items-center gap-2">
								<span className="size-2 rounded-full" style={{ backgroundColor: sourceColors[key] }} />
								{labels[key]}
							</dt>
							<dd className="tabular-nums">
								{formatNumber(totals[key])} ({formatRatio(totals[key], totals.ai)})
							</dd>
						</div>
					))}
				</dl>
			</PopoverContent>
		</Popover>
	);
}
export function Sparkline({ points }: { points: TrafficPoint[] }) {
	if (!points.length) return <span className="text-muted-foreground">—</span>;
	const max = Math.max(1, ...points.map((p) => p.ai));
	const coords = points
		.map((p, i) => `${(i / Math.max(1, points.length - 1)) * 96},${28 - (p.ai / max) * 24}`)
		.join(" ");
	return (
		<svg viewBox="0 0 96 32" className="h-8 w-24" role="img" aria-label={t("traffic.sparkline")}>
			{points.length === 1 ? (
				<circle cx="48" cy={28 - (points[0].ai / max) * 24} r="2" fill={sourceColors.chatgpt} />
			) : (
				<polyline fill="none" stroke={sourceColors.chatgpt} strokeWidth="2" points={coords} />
			)}
		</svg>
	);
}
