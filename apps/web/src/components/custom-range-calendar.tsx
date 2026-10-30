import { t } from "@/i18n";
/**
 * Date-range picker for the "custom range" timeframe option.
 *
 * The picked range is written back into the same `lookback` search param the presets
 * use, encoded as `custom:YYYY-MM-DD:YYYY-MM-DD` — see `parseCustomLookback`. Shared
 * by both timeframe widgets (the filter-bar dropdown and the prompt page's button
 * group) so the two stay in sync.
 *
 * Uses native `<input type="date">` — it already gives us a calendar popup, keyboard
 * entry, locale-aware display and min/max clamping, and it emits exactly the
 * `YYYY-MM-DD` strings the lookback encoding wants.
 */

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useId, useState } from "react";
import { formatDateStr, todayDateStr } from "@/lib/app-locale";
import {
	type CustomLookbackPeriod,
	formatCustomLookback,
	type LookbackPeriod,
	parseCustomLookback,
} from "@/lib/chart-utils";

export function formatCustomRangeLabel(from: string, to: string): string {
	const label = (dateStr: string) => formatDateStr(dateStr, { month: "short", day: "numeric", year: "numeric" });
	return `${label(from)} – ${label(to)}`;
}

export function CustomRangeCalendar({
	selected,
	onApply,
}: {
	selected: LookbackPeriod;
	onApply: (lookback: CustomLookbackPeriod) => void;
}) {
	const id = useId();
	const current = parseCustomLookback(selected);
	const [from, setFrom] = useState(current?.from ?? "");
	const [to, setTo] = useState(current?.to ?? "");

	// Clamp to today in the app's timezone, not the browser's — the data only goes that far.
	const today = todayDateStr();
	const isValid = Boolean(from && to && from <= to);

	return (
		<div className="flex w-64 flex-col gap-3 p-3">
			<div className="flex flex-col gap-1">
				<label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
					{t("core.from")}
				</label>
				<Input
					id={`${id}-from`}
					type="date"
					value={from}
					max={to || today}
					onChange={(e) => setFrom(e.target.value)}
					className="h-8 text-sm"
				/>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
					{t("core.to")}
				</label>
				<Input
					id={`${id}-to`}
					type="date"
					value={to}
					min={from || undefined}
					max={today}
					onChange={(e) => setTo(e.target.value)}
					className="h-8 text-sm"
				/>
			</div>
			<Button
				size="sm"
				className="cursor-pointer"
				disabled={!isValid}
				onClick={() => isValid && onApply(formatCustomLookback(from, to))}
			>
				{t("core.apply")}
			</Button>
		</div>
	);
}
