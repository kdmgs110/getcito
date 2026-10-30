import type { ConversionRequest } from "@workspace/lib/analytics";
import { describe, expect, it } from "vitest";
import { conversionReportCacheKey } from "./conversion-cache";

const connection = {
	brandId: "brand-a",
	revision: "connection-a",
	propertyId: "123",
	hostname: "example.com",
	measurementMode: "observed_session_start" as const,
};
const goal = { id: "00000000-0000-4000-8000-000000000001", revision: 1 };
const input: ConversionRequest = {
	brandId: connection.brandId,
	goalId: goal.id,
	from: "2026-10-01",
	to: "2026-10-28",
	conditions: [],
	grain: "day",
};

describe("conversion report cache identity", () => {
	it("canonicalizes optional defaults and equivalent URL path filters", () => {
		const defaults = { ...input, page: 1, pageSize: 10, pageSearch: "  ", detail: undefined };
		expect(conversionReportCacheKey(connection, goal, defaults)).toBe(
			conversionReportCacheKey(connection, goal, input),
		);
		const url = {
			...input,
			conditions: [
				{ mode: "include" as const, operator: "subtree" as const, value: "https://example.com/jobs/?query=ignore" },
			],
		};
		const path = { ...input, conditions: [{ mode: "include" as const, operator: "subtree" as const, value: "/jobs" }] };
		expect(conversionReportCacheKey(connection, goal, url)).toBe(conversionReportCacheKey(connection, goal, path));
	});
	it.each([
		{ brandId: "brand-b" },
		{ revision: "connection-b" },
		{ propertyId: "456" },
		{ hostname: "other.example" },
		{ measurementMode: "landing_sessions" as const },
	])("isolates connection scope %j", (change) => {
		expect(conversionReportCacheKey({ ...connection, ...change }, goal, input)).not.toBe(
			conversionReportCacheKey(connection, goal, input),
		);
	});
	it("isolates goal revision and all report controls", () => {
		const original = conversionReportCacheKey(connection, goal, input);
		expect(conversionReportCacheKey(connection, { ...goal, revision: 2 }, input)).not.toBe(original);
		for (const change of [
			{ grain: "week" as const },
			{ page: 2 },
			{ pageSize: 25 },
			{ pageSearch: "/jobs" },
			{ detail: "/jobs/1" },
			{ to: "2026-10-29" },
		]) {
			expect(conversionReportCacheKey(connection, goal, { ...input, ...change })).not.toBe(original);
		}
	});
});
