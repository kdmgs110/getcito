import type { AnalyticsMeasurementMode, TrafficCondition } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Plus, Trash2 } from "lucide-react";
import { useId, useRef } from "react";
import { t } from "@/i18n";
import { trafficMeasurementLabels, useTrafficMeasurement } from "./traffic-measurement";
export const conditionLabels = () => ({
	exact: t("traffic.exact"),
	subtree: t("traffic.subtree"),
	contains: t("traffic.contains"),
	regex: t("traffic.regex"),
});
export function conditionsSummary(
	conditions: TrafficCondition[],
	mode?: AnalyticsMeasurementMode,
	allPathsLabel?: string,
): string {
	return conditions.length
		? conditions
				.map(
					(c) =>
						`${c.mode === "exclude" ? t("traffic.exclude") : t("traffic.include")} · ${conditionLabels()[c.operator]} · ${c.value}`,
				)
				.join(" / ")
		: (allPathsLabel ?? trafficMeasurementLabels(mode).allPaths);
}
const selectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-ring";
export function ConditionEditor({
	value,
	onChange,
	disabled = false,
}: {
	value: TrafficCondition[];
	onChange: (value: TrafficCondition[]) => void;
	disabled?: boolean;
}) {
	const measurement = useTrafficMeasurement();
	const id = useId();
	const rowIds = useRef(new WeakMap<TrafficCondition, string>());
	const nextId = useRef(0);
	const keyFor = (row: TrafficCondition) => {
		let key = rowIds.current.get(row);
		if (!key) {
			key = `${id}-${nextId.current++}`;
			rowIds.current.set(row, key);
		}
		return key;
	};
	const update = (index: number, patch: Partial<TrafficCondition>) =>
		onChange(
			value.map((row, i) => {
				if (i !== index) return row;
				const next = { ...row, ...patch };
				rowIds.current.set(next, keyFor(row));
				return next;
			}),
		);
	return (
		<div className="space-y-3">
			{value.map((row, index) => (
				<div key={keyFor(row)} className="flex flex-wrap items-center gap-2">
					<select
						disabled={disabled}
						className={selectClass}
						value={row.mode}
						aria-label={`${t("traffic.include")} / ${t("traffic.exclude")} ${index + 1}`}
						onChange={(e) => update(index, { mode: e.target.value as TrafficCondition["mode"] })}
					>
						<option value="include">{t("traffic.include")}</option>
						<option value="exclude">{t("traffic.exclude")}</option>
					</select>
					<select
						disabled={disabled}
						className={selectClass}
						value={row.operator}
						aria-label={`${t("traffic.savedConditions")} ${index + 1}`}
						onChange={(e) => update(index, { operator: e.target.value as TrafficCondition["operator"] })}
					>
						{Object.entries(conditionLabels()).map(([key, label]) => (
							<option key={key} value={key}>
								{label}
							</option>
						))}
					</select>
					<Input
						disabled={disabled}
						className="min-w-40 flex-1"
						value={row.value}
						aria-label={`${measurement.path} ${index + 1}`}
						placeholder={row.operator === "regex" ? "^/job_listings(/.*)?$" : t("traffic.pathPlaceholder")}
						onChange={(e) => update(index, { value: e.target.value })}
					/>
					<Button
						type="button"
						disabled={disabled}
						variant="ghost"
						size="icon"
						aria-label={`${t("traffic.removeCondition")} ${index + 1}`}
						onClick={() => onChange(value.filter((_, i) => i !== index))}
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			))}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled || value.length >= 20}
				onClick={() => onChange([...value, { mode: "include", operator: "exact", value: "" }])}
			>
				<Plus className="size-4" />
				{t("traffic.addCondition")}
			</Button>
			<p className="text-pretty text-xs text-muted-foreground">{t("traffic.conditionHelp")}</p>
		</div>
	);
}
