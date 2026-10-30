import { describe, expect, it } from "vitest";
import { resolveTrafficHosts } from "./traffic-scope";

describe("traffic domain scope", () => {
	const sites = ["www.busoken.com", "content.busoken.com", "www.busoken.com"];
	it("defaults to a canonical union of owned domains", () => {
		expect(resolveTrafficHosts(sites)).toEqual(["content.busoken.com", "www.busoken.com"]);
		expect(resolveTrafficHosts(sites, "all")).toEqual(resolveTrafficHosts(sites));
	});
	it("filters exact domains without reconnecting", () => {
		expect(resolveTrafficHosts(sites, "https://WWW.busoken.com/")).toEqual(["www.busoken.com"]);
	});
	it("restricts a page detail to its actual domain", () => {
		expect(resolveTrafficHosts(sites, "all", "content.busoken.com")).toEqual(["content.busoken.com"]);
	});
	it("rejects unowned domains and details outside the current filter", () => {
		for (const [scope, detail] of [
			["evil.com", undefined],
			["all", "evil.com"],
			["www.busoken.com", "content.busoken.com"],
		]) {
			expect(() => resolveTrafficHosts(sites, scope, detail)).toThrow("TRAFFIC_INVALID_SITE");
		}
		expect(() => resolveTrafficHosts([])).toThrow("TRAFFIC_INVALID_SITE");
	});
});
