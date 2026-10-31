import { describe, expect, it } from "vitest";
import { ga4HostnameFilter } from "./hostnames-server";

describe("GA4 internationalized hostnames", () => {
	it("matches both exact spellings of the same IDN without adding other hosts", () => {
		expect(ga4HostnameFilter(["https://Rails案件.com/", "xn--rails-qn2hn62m.com"])).toEqual({
			filter: {
				fieldName: "hostName",
				inListFilter: {
					values: ["rails案件.com", "xn--rails-qn2hn62m.com"],
					caseSensitive: false,
				},
			},
		});
	});
	it("preserves exact ASCII filters and rejects an empty host set", () => {
		expect(ga4HostnameFilter(["EXAMPLE.com"])).toEqual({
			filter: {
				fieldName: "hostName",
				stringFilter: { matchType: "EXACT", value: "example.com", caseSensitive: false },
			},
		});
		expect(() => ga4HostnameFilter([])).toThrow();
	});
});
