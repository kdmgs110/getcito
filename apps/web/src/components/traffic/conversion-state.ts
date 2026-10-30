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

/** One event option across hosts; each host's enabled setting still controls reporting. */
export function conversionGoalOptions(goals: ConversionGoal[], hostname: string): ConversionGoal[] {
	const byEvent = new Map<string, ConversionGoal>();
	for (const goal of goals) {
		if (!goal.enabled || (hostname !== "all" && goal.hostname !== hostname)) continue;
		if (!byEvent.has(goal.eventName)) byEvent.set(goal.eventName, goal);
	}
	return [...byEvent.values()];
}

export function resolveConversionSelection(id: string | undefined, goals: ConversionGoal[], hostname: string) {
	const options = conversionGoalOptions(goals, hostname);
	if (!id || id === "all") return { id: "all", goal: undefined, options, invalid: false };
	const original = goals.find((goal) => goal.id === id);
	if (original && !original.enabled) return { id, goal: undefined, options, invalid: true };
	const goal = options.find((goal) => goal.id === id || goal.eventName === original?.eventName);
	return { id: goal?.id ?? id, goal, options, invalid: !goal };
}

export function conversionGoalRevisionKey(goals: ConversionGoal[], hostname: string, eventName?: string) {
	return JSON.stringify(
		goals
			.filter(
				(goal) =>
					goal.enabled &&
					(hostname === "all" || goal.hostname === hostname) &&
					(!eventName || goal.eventName === eventName),
			)
			.map((goal) => [goal.id, goal.revision, goal.eventName, goal.hostname])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	);
}
