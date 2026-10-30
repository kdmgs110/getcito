import { afterEach, describe, expect, it, vi } from "vitest";
import {
	analyticsEncryptionKey,
	analyticsStateHash,
	normalizeAnalyticsHostname,
	openAnalyticsSecret,
	sealAnalyticsSecret,
	trafficCacheKey,
} from "./traffic-security";

afterEach(() => vi.unstubAllEnvs());

describe("GA4 credential encryption", () => {
	it("round trips with randomized authenticated encryption and no plaintext at rest", () => {
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
		const first = sealAnalyticsSecret("refresh-credential", "ga4:refresh:brand-a");
		const second = sealAnalyticsSecret("refresh-credential", "ga4:refresh:brand-a");
		expect(first).not.toEqual(second);
		expect(first).not.toContain("refresh-credential");
		expect(openAnalyticsSecret(first, "ga4:refresh:brand-a")).toBe("refresh-credential");
	});
	it("rejects credential swaps between brands and OAuth verifier purposes", () => {
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
		const sealed = sealAnalyticsSecret("secret", "ga4:refresh:brand-a");
		expect(() => openAnalyticsSecret(sealed, "ga4:refresh:brand-b")).toThrow("ANALYTICS_RECONNECT_REQUIRED");
		expect(() => openAnalyticsSecret(sealed, "ga4:pkce:brand-a")).toThrow("ANALYTICS_RECONNECT_REQUIRED");
	});
	it("rejects tampering and a wrong key without reflecting secret material", () => {
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
		const sealed = sealAnalyticsSecret("sensitive-test-credential", "context");
		expect(() => openAnalyticsSecret(`${sealed}.tampered`, "context")).toThrow(/^ANALYTICS_RECONNECT_REQUIRED$/);
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
		expect(() => openAnalyticsSecret(sealed, "context")).toThrow(/^ANALYTICS_RECONNECT_REQUIRED$/);
	});
	it("accepts 32-byte base64 keys and rejects missing or short keys", () => {
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 17).toString("base64"));
		expect(analyticsEncryptionKey()).toHaveLength(32);
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "");
		expect(() => analyticsEncryptionKey()).toThrow("ANALYTICS_NOT_CONFIGURED");
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "too-short");
		expect(() => analyticsEncryptionKey()).toThrow("ANALYTICS_NOT_CONFIGURED");
	});
});

describe("Analytics query identity", () => {
	const connection = { brandId: "brand-a", revision: "revision-a", propertyId: "123", hostname: "example.com" };
	const input = {
		brandId: "brand-a",
		from: "2026-10-01",
		to: "2026-10-28",
		conditions: [{ mode: "include", operator: "exact", value: "/" }],
	};
	it("separates organizations, connection revisions, query kinds and actual conditions", () => {
		const key = trafficCacheKey("overview", connection, input);
		expect(
			new Set([
				key,
				trafficCacheKey("overview", { ...connection, brandId: "brand-b" }, input),
				trafficCacheKey("overview", { ...connection, revision: "revision-b" }, input),
				trafficCacheKey("pages", connection, input),
				trafficCacheKey("overview", connection, { ...input, conditions: [] }),
				trafficCacheKey("overview", connection, { ...input, to: "2026-10-29" }),
			]).size,
		).toBe(6);
	});
	it("is stable across object property order and does not expose URL paths", () => {
		const key = trafficCacheKey("overview", connection, input);
		expect(key).toMatch(/^[a-f0-9]{64}$/);
		expect(
			trafficCacheKey("overview", connection, {
				to: input.to,
				conditions: input.conditions,
				from: input.from,
				brandId: input.brandId,
			}),
		).toBe(key);
	});
	it("isolates multi-domain measurement results while preserving the legacy landing default", () => {
		const legacy = trafficCacheKey("overview", connection, input);
		expect(trafficCacheKey("overview", { ...connection, measurementMode: "landing_sessions" }, input)).toBe(legacy);
		expect(trafficCacheKey("overview", { ...connection, measurementMode: "observed_session_start" }, input)).not.toBe(
			legacy,
		);
	});
	it("stores a hash rather than a recoverable OAuth state value", () => {
		expect(analyticsStateHash("one-time-state")).toMatch(/^[a-f0-9]{64}$/);
		expect(analyticsStateHash("one-time-state")).not.toBe(analyticsStateHash("other-state"));
	});
});

describe("Analytics site normalization", () => {
	it("uses an exact hostname without implicitly merging www or subdomains", () => {
		expect(normalizeAnalyticsHostname("https://Freelance.Example.COM/path")).toBe("freelance.example.com");
		expect(normalizeAnalyticsHostname("www.example.com")).not.toBe(normalizeAnalyticsHostname("example.com"));
	});
	it.each([
		"javascript:alert(1)",
		"https://user:password@example.com/",
		"https://example.com:8443/",
		"https:///",
	])("rejects non-site values: %s", (value) => {
		expect(() => normalizeAnalyticsHostname(value)).toThrow("TRAFFIC_INVALID_SITE");
	});
});
