import { normalizeAnalyticsHostname } from "./traffic-security";

/** Resolve only brand-owned hosts; callers cannot widen the GA4 dataset. */
export function resolveTrafficHosts(sites: string[], requested?: string, detailHostname?: string): string[] {
	const allowed = [...new Set(sites)].sort();
	if (!allowed.length) throw new Error("TRAFFIC_INVALID_SITE");
	let hosts = allowed;
	if (requested && requested !== "all") {
		const hostname = normalizeAnalyticsHostname(requested);
		if (!allowed.includes(hostname)) throw new Error("TRAFFIC_INVALID_SITE");
		hosts = [hostname];
	}
	if (detailHostname) {
		const hostname = normalizeAnalyticsHostname(detailHostname);
		if (!hosts.includes(hostname)) throw new Error("TRAFFIC_INVALID_SITE");
		hosts = [hostname];
	}
	return hosts;
}
