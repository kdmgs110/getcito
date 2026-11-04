import { createHash, randomUUID } from "node:crypto";
import { createAnalyticsOAuthClient } from "@workspace/lib/analytics/server";
import { db } from "@workspace/lib/db/db";
import { gscConnections } from "@workspace/lib/db/schema";
import { GSC_FILTER_VERSION } from "@workspace/lib/search-console";
import { and, eq } from "drizzle-orm";
import { requireTrafficAccess } from "./traffic-runtime";
import { analyticsEncryptionKey, openAnalyticsSecret, sealAnalyticsSecret } from "./traffic-security";

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function searchConsoleOAuthConfig() {
	const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
	const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI;
	if (!clientId || !clientSecret || !redirectUri) throw new Error("GSC_NOT_CONFIGURED");
	try {
		const url = new URL(redirectUri);
		if (
			url.protocol !== "https:" &&
			!(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
		)
			throw new Error();
		if (
			url.username ||
			url.password ||
			url.hash ||
			url.search ||
			url.pathname !== "/api/search-console/google/callback"
		)
			throw new Error();
		if (process.env.APP_URL && new URL(process.env.APP_URL).origin !== url.origin) throw new Error();
		analyticsEncryptionKey();
	} catch {
		throw new Error("GSC_NOT_CONFIGURED");
	}
	return { clientId, clientSecret, redirectUri };
}

export function searchConsoleConfigured() {
	try {
		searchConsoleOAuthConfig();
		return true;
	} catch {
		return false;
	}
}

export async function requireSearchConsoleAccess(brandId: string, manage = false) {
	return requireTrafficAccess(brandId, manage);
}

export async function currentSearchConsoleConnection(brandId: string) {
	const [connection] = await db.select().from(gscConnections).where(eq(gscConnections.brandId, brandId)).limit(1);
	return connection;
}

export async function assertSearchConsoleRevision(brandId: string, revision: string) {
	const current = await currentSearchConsoleConnection(brandId);
	if (!current || current.revision !== revision || current.status !== "connected")
		throw new Error("GSC_CONNECTION_CHANGED");
}

export function searchConsoleCacheKey(
	connection: { brandId: string; revision: string; propertyId: string | null },
	hosts: string[],
	filters: unknown,
) {
	return createHash("sha256")
		.update(
			JSON.stringify({
				version: GSC_FILTER_VERSION,
				brandId: connection.brandId,
				revision: connection.revision,
				propertyId: connection.propertyId,
				hosts: [...hosts].sort(),
				filters,
			}),
		)
		.digest("hex");
}

export async function markSearchConsoleReauth(connection: typeof gscConnections.$inferSelect) {
	await db
		.update(gscConnections)
		.set({ status: "needs_reauth", updatedAt: new Date() })
		.where(and(eq(gscConnections.brandId, connection.brandId), eq(gscConnections.revision, connection.revision)));
}

const refreshing = new Map<string, Promise<string>>();
export async function searchConsoleAccessToken(connection: typeof gscConnections.$inferSelect): Promise<string> {
	if (connection.status !== "connected") throw new Error("GSC_RECONNECT_REQUIRED");
	const existing = refreshing.get(connection.revision);
	if (existing) return existing;
	const promise = (async () => {
		try {
			const client = createAnalyticsOAuthClient(searchConsoleOAuthConfig());
			let refreshToken: string;
			try {
				refreshToken = openAnalyticsSecret(connection.refreshTokenCiphertext, `gsc:refresh:${connection.brandId}`);
			} catch {
				throw new Error("GSC_RECONNECT_REQUIRED");
			}
			client.setCredentials({ refresh_token: refreshToken });
			const result = await client.getAccessToken();
			if (!result.token) throw new Error("GSC_RECONNECT_REQUIRED");
			if (client.credentials.refresh_token && client.credentials.refresh_token !== refreshToken) {
				await db
					.update(gscConnections)
					.set({
						refreshTokenCiphertext: sealAnalyticsSecret(
							client.credentials.refresh_token,
							`gsc:refresh:${connection.brandId}`,
						),
						updatedAt: new Date(),
					})
					.where(and(eq(gscConnections.brandId, connection.brandId), eq(gscConnections.revision, connection.revision)));
			}
			return result.token;
		} catch (error) {
			const e = error as { message?: string; response?: { data?: { error?: string } } };
			if (e.response?.data?.error === "invalid_grant" || e.message === "GSC_RECONNECT_REQUIRED") {
				await markSearchConsoleReauth(connection);
				throw new Error("GSC_RECONNECT_REQUIRED");
			}
			if (e.message === "GSC_NOT_CONFIGURED") throw new Error("GSC_NOT_CONFIGURED");
			throw new Error("GSC_UNAVAILABLE");
		}
	})();
	refreshing.set(connection.revision, promise);
	try {
		return await promise;
	} finally {
		refreshing.delete(connection.revision);
	}
}

export const newSearchConsoleRevision = randomUUID;
