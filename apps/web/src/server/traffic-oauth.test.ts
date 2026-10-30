import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	results: [] as unknown[][],
	wheres: [] as unknown[],
	writes: [] as unknown[],
	inserts: [] as unknown[],
	auth: vi.fn(),
	manage: vi.fn(),
	access: vi.fn(),
	token: vi.fn(),
}));

vi.mock("@workspace/lib/analytics/server", () => ({
	createAnalyticsOAuthClient: () => ({
		getToken: mocks.token,
		generateCodeVerifierAsync: async () => ({ codeVerifier: "pkce-verifier", codeChallenge: "pkce-challenge" }),
		generateAuthUrl: (options: Record<string, string>) =>
			`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(options).toString()}`,
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({ requireAuthSession: mocks.auth, requireOrgManageAccess: mocks.manage }));
vi.mock("./traffic-runtime", () => ({
	ANALYTICS_SCOPE: "https://www.googleapis.com/auth/analytics.readonly",
	analyticsOAuthConfig: () => ({
		clientId: "test-client",
		clientSecret: "test-secret",
		redirectUri: "https://app.example/api/analytics/google/callback",
	}),
	newTrafficRevision: () => "00000000-0000-4000-8000-000000000001",
	requireTrafficAccess: mocks.access,
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
			values: (value: unknown) => {
				mocks.inserts.push(value);
				return chain;
			},
			limit: () => Promise.resolve(mocks.results.shift() ?? []),
			returning: () => Promise.resolve(mocks.results.shift() ?? []),
			onConflictDoUpdate: () => Promise.resolve(),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle delete/update builders are awaitable.
			then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve),
		};
		return chain;
	};
	const db = {
		select: query,
		update: query,
		insert: query,
		delete: query,
		transaction: async (fn: (tx: unknown) => unknown) => fn(db),
	};
	return { db };
});

import { finishTrafficOAuth, startTrafficOAuth } from "./traffic-oauth";
import { analyticsStateHash, openAnalyticsSecret, sealAnalyticsSecret } from "./traffic-security";

const rawState = "s".repeat(43);
const stateHash = analyticsStateHash(rawState);
const session = { user: { id: "user-a" }, session: { id: "session-a" } };
function storedState() {
	return {
		stateHash,
		brandId: "brand-a",
		userId: "user-a",
		sessionId: "session-a",
		verifierCiphertext: sealAnalyticsSecret("private-pkce", `ga4:pkce:${stateHash}`),
	};
}
function request(query = `state=${rawState}&code=private-auth-code`) {
	return new Request(`https://app.example/api/analytics/google/callback?${query}`);
}

beforeEach(() => {
	vi.stubEnv("ANALYTICS_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
	mocks.results.length = 0;
	mocks.wheres.length = 0;
	mocks.writes.length = 0;
	mocks.inserts.length = 0;
	mocks.auth.mockReset().mockResolvedValue(session);
	mocks.manage.mockReset().mockResolvedValue(undefined);
	mocks.access.mockReset().mockResolvedValue({ session });
	mocks.token.mockReset().mockResolvedValue({
		tokens: { refresh_token: "private-refresh-token", scope: "https://www.googleapis.com/auth/analytics.readonly" },
	});
});
afterEach(() => vi.unstubAllEnvs());

describe("GA4 OAuth initiation", () => {
	it("requests readonly offline access with PKCE and stores only hashed, user/session-bound state", async () => {
		const { url } = await startTrafficOAuth("brand-a");
		expect(mocks.access).toHaveBeenCalledWith("brand-a", true);
		const parsed = new URL(url);
		expect(parsed.searchParams.get("access_type")).toBe("offline");
		expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
		expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/analytics.readonly");
		const saved = mocks.inserts[0] as {
			stateHash: string;
			verifierCiphertext: string;
			userId: string;
			sessionId: string;
			expiresAt: Date;
		};
		expect(saved.stateHash).toBe(analyticsStateHash(parsed.searchParams.get("state") ?? ""));
		expect(saved.userId).toBe("user-a");
		expect(saved.sessionId).toBe("session-a");
		expect(saved.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600_000);
		expect(saved.verifierCiphertext).not.toContain("pkce-verifier");
		expect(openAnalyticsSecret(saved.verifierCiphertext, `ga4:pkce:${saved.stateHash}`)).toBe("pkce-verifier");
	});
});

describe("GA4 OAuth callback", () => {
	it("encrypts the refresh credential and clears selected property before requiring selection", async () => {
		mocks.results.push([storedState()], [{ id: "session-a" }], [{ hash: stateHash }], []);
		const response = await finishTrafficOAuth(request());
		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe("/app/brand-a/traffic?ga4=connected");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(mocks.token).toHaveBeenCalledWith({ code: "private-auth-code", codeVerifier: "private-pkce" });
		const inserted = mocks.inserts[0] as { refreshTokenCiphertext: string };
		expect(inserted.refreshTokenCiphertext).not.toContain("private-refresh-token");
		expect(openAnalyticsSecret(inserted.refreshTokenCiphertext, "ga4:refresh:brand-a")).toBe("private-refresh-token");
	});
	it("atomically limits state claims by hash, user, session, expiry and unused status", async () => {
		mocks.results.push([]);
		await finishTrafficOAuth(request());
		const query = new PgDialect().sqlToQuery(mocks.wheres[0] as never);
		expect(query.params).toEqual(
			expect.arrayContaining([stateHash, "user-a", "session-a", expect.stringMatching(/^\d{4}-\d\d-\d\dT/)]),
		);
		expect(query.sql).toContain('"consumed_at" is null');
		expect(query.sql).toContain('"expires_at" >');
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("does not exchange a replayed or unknown state", async () => {
		mocks.results.push([]);
		const response = await finishTrafficOAuth(request());
		expect(response.headers.get("Location")).toBe("/app");
		expect(mocks.token).not.toHaveBeenCalled();
		expect(mocks.inserts).toHaveLength(0);
	});
	it("stops on consent denial without reflecting provider error details", async () => {
		mocks.results.push([storedState()]);
		const response = await finishTrafficOAuth(
			request(`state=${rawState}&error=access_denied&error_description=private-provider-message`),
		);
		expect(response.headers.get("Location")).toBe("/app/brand-a/traffic?ga4=error");
		expect(await response.text()).toBe("");
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("rejects logged-out sessions and revoked organization management access", async () => {
		mocks.auth.mockRejectedValueOnce(new Error("Unauthenticated"));
		expect((await finishTrafficOAuth(request())).headers.get("Location")).toBe("/app");
		mocks.results.push([storedState()]);
		mocks.manage.mockRejectedValueOnce(new Error("Forbidden"));
		expect((await finishTrafficOAuth(request())).headers.get("Location")).toBe("/app/brand-a/traffic?ga4=error");
		expect(mocks.token).not.toHaveBeenCalled();
	});
	it("does not reconnect after a disconnect invalidates state during token exchange", async () => {
		mocks.results.push([storedState()], [{ id: "session-a" }], []);
		const response = await finishTrafficOAuth(request());
		expect(response.headers.get("Location")).toBe("/app/brand-a/traffic?ga4=error");
		expect(mocks.token).toHaveBeenCalledTimes(1);
		expect(mocks.inserts).toHaveLength(0);
	});
	it("does not persist a credential after the session expires during exchange", async () => {
		mocks.results.push([storedState()], []);
		const response = await finishTrafficOAuth(request());
		expect(response.headers.get("Location")).toBe("/app/brand-a/traffic?ga4=error");
		expect(mocks.inserts).toHaveLength(0);
	});
	it("requires a refresh credential and analytics readonly permission", async () => {
		mocks.results.push([storedState()]);
		mocks.token.mockResolvedValueOnce({ tokens: { access_token: "private-access-token" } });
		expect((await finishTrafficOAuth(request())).headers.get("Location")).toBe("/app/brand-a/traffic?ga4=error");
		mocks.results.push([storedState()]);
		mocks.token.mockResolvedValueOnce({ tokens: { refresh_token: "private-refresh-token", scope: "openid email" } });
		expect((await finishTrafficOAuth(request())).headers.get("Location")).toBe("/app/brand-a/traffic?ga4=error");
		expect(mocks.inserts).toHaveLength(0);
	});
});
