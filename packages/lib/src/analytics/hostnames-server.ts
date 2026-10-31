import { domainToUnicode } from "node:url";
import { type GAFilterExpression, normalizeHostname, stringFilter } from "./filters";

/** GA4 can store either spelling of an IDN; both represent exactly the same host. */
export function ga4HostnameFilter(hostnames: string[]): GAFilterExpression {
	if (!hostnames.length) throw new Error("Select at least one website");
	const values = [
		...new Set(
			hostnames.flatMap((value) => {
				const ascii = normalizeHostname(value);
				const unicode = domainToUnicode(ascii);
				return unicode && normalizeHostname(unicode) === ascii ? [ascii, unicode] : [ascii];
			}),
		),
	].sort();
	return values.length === 1
		? stringFilter("hostName", values[0], "EXACT", false)
		: { filter: { fieldName: "hostName", inListFilter: { values, caseSensitive: false } } };
}
