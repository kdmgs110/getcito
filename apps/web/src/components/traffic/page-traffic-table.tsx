import { useState } from "react";
import { Search } from "lucide-react";
import type { TrafficGrain, TrafficPages } from "@workspace/lib/analytics";
import { aggregateTrafficPoints } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { formatNumber, t } from "@/i18n";
import { Composition, formatRatio, Sparkline } from "./traffic-chart";
import { TrafficCard } from "./shared";
import { useTrafficMeasurement } from "./traffic-measurement";
export function PageTrafficTable({
	data,
	hostname,
	query,
	pageScope,
	pageSize,
	grain,
	from,
	to,
	onSearch,
	onScope,
	onPageSize,
	onPage,
	onDetail,
}: {
	data: TrafficPages;
	hostname: string;
	query: string;
	pageScope: "ai" | "all";
	pageSize: number;
	grain: TrafficGrain;
	from: string;
	to: string;
	onSearch: (v: string) => void;
	onScope: (v: "ai" | "all") => void;
	onPageSize: (v: number) => void;
	onPage: (v: number) => void;
	onDetail: (path: string) => void;
}) {
	const measurement = useTrafficMeasurement();
	const [search, setSearch] = useState(query);
	return (
		<TrafficCard
			title={measurement.pageTable}
			action={
				<div className="flex flex-wrap gap-2">
					<form
						className="relative"
						onSubmit={(e) => {
							e.preventDefault();
							onSearch(search);
						}}
					>
						<Search className="pointer-events-none absolute left-3 top-3 size-3.5 text-muted-foreground" />
						<Input
							className="pl-9 pr-16"
							aria-label={t("traffic.pathSearch")}
							placeholder={t("traffic.pathSearch")}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<Button type="submit" size="sm" variant="ghost" className="absolute right-1 top-0.5 h-8">
							{t("traffic.apply")}
						</Button>
					</form>
					<select
						className="h-9 rounded-md border bg-background px-2 text-sm"
						aria-label={t("traffic.pageSize")}
						value={pageSize}
						onChange={(e) => onPageSize(Number(e.target.value))}
					>
						{[5, 10, 25, 50].map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</div>
			}
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<p className="text-pretty text-xs text-muted-foreground">{measurement.pageTableHelp}</p>
				<select
					className="h-8 rounded-md border bg-background px-2 text-xs"
					value={pageScope}
					onChange={(e) => onScope(e.target.value as "ai" | "all")}
					aria-label={measurement.allPages}
				>
					<option value="ai">{measurement.aiPages}</option>
					<option value="all">{measurement.allPages}</option>
				</select>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm tabular-nums">
					<thead className="text-xs text-muted-foreground">
						<tr>
							{[
								t("traffic.pageIdentity"),
								`${measurement.ai}${pageScope === "ai" ? " ↓" : ""}`,
								`${measurement.total}${pageScope === "all" ? " ↓" : ""}`,
								measurement.ratio,
								t("traffic.composition"),
								t("traffic.sparkline"),
								"",
							].map((label, i) => (
								<th
									key={label}
									className={`border-b px-2 py-3 font-medium leading-relaxed ${i === 0 ? "whitespace-nowrap text-left" : "min-w-20 text-right"}`}
								>
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{data.rows.map((row) => (
							<tr key={row.path} className="hover:bg-muted/40">
								<th scope="row" className="w-[42%] min-w-64 max-w-lg border-b px-2 py-4 text-left font-normal">
									<span className="block break-words font-semibold leading-relaxed">
										{row.title || t("traffic.titleUnavailable")}
									</span>
									<span className="mt-1 block break-all text-xs leading-relaxed text-muted-foreground">
										{hostname && row.path.startsWith("/")
											? `https://${hostname}${row.path}`
											: measurement.unavailablePath}
									</span>
								</th>
								<td className="border-b px-2 py-3 text-right font-medium">{formatNumber(row.ai)}</td>
								<td className="border-b px-2 py-3 text-right">{formatNumber(row.total)}</td>
								<td className="border-b px-2 py-3 text-right">{formatRatio(row.ai, row.total)}</td>
								<td className="border-b px-2 py-3">
									<Composition totals={row} />
								</td>
								<td className="border-b px-2 py-3">
									<Sparkline points={aggregateTrafficPoints(row.trend, grain, from, to)} />
								</td>
								<td className="border-b px-2 py-3 text-right">
									{row.path.startsWith("/") && (
										<Button
											variant="link"
											size="sm"
											onClick={() => onDetail(row.path)}
											aria-label={`${t("traffic.viewTrend")}: ${row.path}`}
										>
											{t("traffic.viewTrend")} ›
										</Button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{data.rows.length === 0 && (
				<p className="py-8 text-center text-sm text-muted-foreground">{t("traffic.noPages")}</p>
			)}
			<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground">
					{t("traffic.pageCount", {
						from: data.totalRows ? formatNumber((data.page - 1) * data.pageSize + 1) : "0",
						to: formatNumber(Math.min(data.totalRows, data.page * data.pageSize)),
						total: formatNumber(data.totalRows),
					})}
				</p>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
						{t("traffic.previous")}
					</Button>
					<span className="text-xs tabular-nums">
						{formatNumber(data.page)} / {formatNumber(Math.max(1, Math.ceil(data.totalRows / data.pageSize)))}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={data.page * data.pageSize >= data.totalRows}
						onClick={() => onPage(data.page + 1)}
					>
						{t("traffic.next")}
					</Button>
				</div>
			</div>
		</TrafficCard>
	);
}
