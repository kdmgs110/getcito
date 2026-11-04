import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	results: [] as unknown[][],
	writes: [] as unknown[],
	wheres: [] as unknown[],
	access: vi.fn(),
	token: vi.fn(),
	credentials: {} as { refresh_token?: string },
	setCredentials: vi.fn(),
}));
vi.mock("./traffic-runtime", () => ({ requireTrafficAccess: mocks.access }));
vi.mock("@workspace/lib/analytics/server", () => ({
	createAnalyticsOAuthClient: () => ({
		getAccessToken: mocks.token,
		get credentials() {
			return mocks.credentials;
		},
		setCredentials: (value: { refresh_token?: string }) => {
			mocks.credentials = value;
			mocks.setCredentials({ ...value });
		},
	}),
}));
vi.mock("@workspace/lib/db/db", () => {
	const query = () => {
		const chain = {
			from: () => chain,
			where: (value: unknown) => {
				mocks.wheres.push(value);
				return chain;
			},
			set: (value: unknown) => {
				mocks.writes.push(value);
				return chain;
			},
			limit: () => Promise.resolve(mocks.results.shift() ?? []),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are awaitable.
			then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
		};
		return chain;
	};
	return { db: { select: query, update: query } };
});

import {
	assertSearchConsoleRevision,
	currentSearchConsoleConnection,
	requireSearchConsoleAccess,
	searchConsoleAccessToken,
	searchConsoleCacheKey,
	searchConsoleConfigured,
	searchConsoleOAuthConfig,
} from "./search-console-runtime";
import { openAnalyticsSecret, sealAnalyticsSecret } from "./traffic-security";

function connection() {
	return {
		brandId: "brand-a",
		refreshTokenCiphertext: sealAnalyticsSecret("private-refresh", "gsc:refresh:brand-a"),
		connectedBy: "user-a",
		propertyId: "https://example.com/",
		status: "connected",
		revision: "revision-a",
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}
beforeEach(() => {
	vi.stubEnv("GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "test-client");
	vi.stubEnv("GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "test-secret");
	vi.stubEnv("GOOGLE_SEARCH_CONSOLE_REDIRECT_URI", "https://app.example/api/search-console/google/callback");
	vi.stubEnv("APP_URL", "https://app.example");
	vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
	mocks.results.length = 0;
	mocks.writes.length = 0;
	mocks.wheres.length = 0;
	mocks.credentials = {};
	mocks.access.mockReset().mockResolvedValue({ sites: ["example.com"] });
	mocks.token.mockReset().mockResolvedValue({ token: "private-access" });
	mocks.setCredentials.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Search Console runtime configuration", () => {
	it("uses separate GSC OAuth credentials and validates configuration without exposing secrets", () => {
		expect(searchConsoleOAuthConfig()).toEqual({
			clientId: "test-client",
			clientSecret: "test-secret",
			redirectUri: "https://app.example/api/search-console/google/callback",
		});
		vi.stubEnv("GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "");
		expect(searchConsoleConfigured()).toBe(false);
		expect(() => searchConsoleOAuthConfig()).toThrow(/^GSC_NOT_CONFIGURED$/);
	});
	it.each([
		"http://app.example/api/search-console/google/callback",
		"https://evil.example/api/search-console/google/callback",
		"https://app.example/api/analytics/google/callback",
		"https://u:p@app.example/api/search-console/google/callback",
		"https://app.example/api/search-console/google/callback?secret=x",
		"https://app.example/api/search-console/google/callback#x",
	])("rejects an invalid callback: %s", (url) => {
		vi.stubEnv("GOOGLE_SEARCH_CONSOLE_REDIRECT_URI", url);
		expect(searchConsoleConfigured()).toBe(false);
	});
	it("permits local HTTP only when it matches APP_URL and still requires an encryption key", () => {
		vi.stubEnv("APP_URL", "http://localhost:3001");
		vi.stubEnv("GOOGLE_SEARCH_CONSOLE_REDIRECT_URI", "http://localhost:3001/api/search-console/google/callback");
		expect(searchConsoleConfigured()).toBe(true);
		vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "short");
		expect(searchConsoleConfigured()).toBe(false);
	});
	it("delegates brand member and manager checks before reading connection data", async () => {
		await requireSearchConsoleAccess("brand-a", true);
		expect(mocks.access).toHaveBeenCalledWith("brand-a", true);
		await requireSearchConsoleAccess("brand-a");
		expect(mocks.access).toHaveBeenLastCalledWith("brand-a", false);
	});
});

describe("Search Console credential lifecycle", () => {
	it("loads the connection only by brand and refuses stale revisions or disconnected records", async () => {
		const record = connection();
		mocks.results.push([record]);
		expect(await currentSearchConsoleConnection("brand-a")).toEqual(record);
		const query = new PgDialect().sqlToQuery(mocks.wheres[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
		expect(query.sql).toContain('"gsc_connections"."brand_id"');
		expect(query.params).toEqual(["brand-a"]);
		for (const rows of [[], [{ ...record, revision: "new-revision" }], [{ ...record, status: "needs_reauth" }]]) {
			mocks.results.push(rows);
			await expect(assertSearchConsoleRevision("brand-a", record.revision)).rejects.toThrow("GSC_CONNECTION_CHANGED");
		}
	});
	it("decrypts credentials with the GSC brand context and stores only a rotated ciphertext", async () => {
		const record = connection();
		mocks.token.mockImplementation(async () => {
			mocks.credentials.refresh_token = "rotated-refresh";
			return { token: "private-access" };
		});
		expect(await searchConsoleAccessToken(record)).toBe("private-access");
		expect(mocks.setCredentials).toHaveBeenCalledWith({ refresh_token: "private-refresh" });
		const write = mocks.writes[0] as { refreshTokenCiphertext: string };
		expect(write.refreshTokenCiphertext).not.toContain("rotated-refresh");
		expect(openAnalyticsSecret(write.refreshTokenCiphertext, "gsc:refresh:brand-a")).toBe("rotated-refresh");
		const query = new PgDialect().sqlToQuery(mocks.wheres[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
		expect(query.params).toEqual(["brand-a", "revision-a"]);
	});
	it("deduplicates simultaneous refreshes for a connection and clears the in-flight entry", async () => {
		let release: (result: { token: string }) => void = () => {};
		mocks.token.mockImplementation(
			() =>
				new Promise<{ token: string }>((resolve) => {
					release = resolve;
				}),
		);
		const record = connection();
		const first = searchConsoleAccessToken(record);
		const second = searchConsoleAccessToken(record);
		expect(mocks.token).toHaveBeenCalledTimes(1);
		release({ token: "private-access" });
		expect(await Promise.all([first, second])).toEqual(["private-access", "private-access"]);
		mocks.token.mockResolvedValue({ token: "fresh-access" });
		expect(await searchConsoleAccessToken(record)).toBe("fresh-access");
		expect(mocks.token).toHaveBeenCalledTimes(2);
	});
	it("marks revoked grants for reauthentication without leaking provider error details", async () => {
		mocks.token.mockRejectedValue({
			response: { data: { error: "invalid_grant", error_description: "private credential" } },
		});
		await expect(searchConsoleAccessToken(connection())).rejects.toThrow(/^GSC_RECONNECT_REQUIRED$/);
		expect(mocks.writes).toContainEqual(expect.objectContaining({ status: "needs_reauth" }));
	});
	it("rejects tokens swapped from GA4 or another brand before contacting Google", async () => {
		const record = connection();
		for (const context of ["ga4:refresh:brand-a", "gsc:refresh:brand-b"]) {
			await expect(
				searchConsoleAccessToken({ ...record, refreshTokenCiphertext: sealAnalyticsSecret("private", context) }),
			).rejects.toThrow(/^GSC_RECONNECT_REQUIRED$/);
		}
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("sanitizes network errors and does not refresh records requiring reauthentication", async () => {
		mocks.token.mockRejectedValue(new Error("private-access network detail"));
		await expect(searchConsoleAccessToken(connection())).rejects.toThrow(/^GSC_UNAVAILABLE$/);
		mocks.token.mockClear();
		await expect(searchConsoleAccessToken({ ...connection(), status: "needs_reauth" })).rejects.toThrow(
			/^GSC_RECONNECT_REQUIRED$/,
		);
		expect(mocks.token).not.toHaveBeenCalled();
	});
});

describe("Search Console cache scope", () => {
	it("isolates brand, revision, property, hosts, AI condition, URL conditions and date range", () => {
		const record = connection();
		const filters = {
			startDate: "2026-10-01",
			endDate: "2026-10-28",
			keyword: "",
			aiQuestionsOnly: false,
			urlConditions: [],
		};
		const key = searchConsoleCacheKey(record, ["example.com"], filters);
		expect(key).toMatch(/^[a-f\d]{64}$/);
		const keys = [
			key,
			searchConsoleCacheKey({ ...record, brandId: "brand-b" }, ["example.com"], filters),
			searchConsoleCacheKey({ ...record, revision: "new-revision" }, ["example.com"], filters),
			searchConsoleCacheKey({ ...record, propertyId: "sc-domain:example.com" }, ["example.com"], filters),
			searchConsoleCacheKey(record, ["www.example.com"], filters),
			searchConsoleCacheKey(record, ["example.com"], { ...filters, aiQuestionsOnly: true }),
			searchConsoleCacheKey(record, ["example.com"], {
				...filters,
				urlConditions: [{ operator: "contains", value: "/jobs" }],
			}),
			searchConsoleCacheKey(record, ["example.com"], { ...filters, endDate: "2026-10-29" }),
		];
		expect(new Set(keys).size).toBe(keys.length);
		expect(searchConsoleCacheKey(record, ["example.com", "www.example.com"], filters)).toBe(
			searchConsoleCacheKey(record, ["www.example.com", "example.com"], filters),
		);
	});
});
