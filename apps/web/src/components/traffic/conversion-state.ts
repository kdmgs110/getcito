import type { ConversionGoal } from "@workspace/lib/analytics";
import { formatNumber } from "@/i18n";
export function conversionNumber(value: number | null): string {
	return value === null ? "—" : formatNumber(value, { maximumFractionDigits: 2 });
}
export function conversionRate(value: number | null): string {
	return value === null ? "—" : `${formatNumber(value * 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
export function resolveConversionGoal(
	id: string | undefined,
	goals: ConversionGoal[],
): { goal?: ConversionGoal; invalid: boolean } {
	if (id) {
		const goal = goals.find((item) => item.id === id && item.enabled);
		return { goal, invalid: !goal };
	}
	return { goal: goals.find((item) => item.enabled), invalid: false };
}
