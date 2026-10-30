import { AI_PROVIDERS, type TrafficGrain, type TrafficPoint, type TrafficTotals } from "./types";
const DAY = 86_400_000;
export function emptyTrafficTotals(): TrafficTotals {
	return { ai: 0, total: 0, chatgpt: 0, perplexity: 0, gemini: 0, claude: 0, copilot: 0, other: 0 };
}
export function addTrafficTotals(target: TrafficTotals, value: TrafficTotals): void {
	for (const key of ["ai", "total", ...AI_PROVIDERS] as const) target[key] += value[key];
}
export function trafficDates(from: string, to: string): string[] {
	const dates: string[] = [];
	for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY)
		dates.push(new Date(t).toISOString().slice(0, 10));
	return dates;
}
export function defaultTrafficRange(timeZone: string, now = new Date()): { from: string; to: string } {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const part = (type: string) => parts.find((p) => p.type === type)?.value;
	const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
	return {
		from: new Date(today - 28 * DAY).toISOString().slice(0, 10),
		to: new Date(today - DAY).toISOString().slice(0, 10),
	};
}
export function aggregateTrafficPoints(
	points: TrafficPoint[],
	grain: TrafficGrain,
	from?: string,
	to?: string,
): TrafficPoint[] {
	const buckets = new Map<string, TrafficPoint>();
	for (const point of points) {
		if ((from && point.date < from) || (to && point.date > to)) continue;
		const date = new Date(`${point.date}T00:00:00Z`);
		if (grain === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
		if (grain === "month") date.setUTCDate(1);
		const key = date.toISOString().slice(0, 10);
		const bucket = buckets.get(key) ?? { date: key, ...emptyTrafficTotals() };
		addTrafficTotals(bucket, point);
		buckets.set(key, bucket);
	}
	return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}
