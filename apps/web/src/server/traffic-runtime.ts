import { randomUUID } from "node:crypto";
import { createAnalyticsOAuthClient } from "@workspace/lib/analytics/server";
import { db } from "@workspace/lib/db/db";
import { brands, ga4Connections } from "@workspace/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { checkOrgManageAccess, requireAuthSession, requireOrgAccess, requireOrgManageAccess } from "@/lib/auth/helpers";
import {
	analyticsEncryptionKey,
	normalizeAnalyticsHostname,
	openAnalyticsSecret,
	sealAnalyticsSecret,
} from "./traffic-security";

export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export function analyticsOAuthConfig() {
	const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
	const redirectUri = process.env.GOOGLE_ANALYTICS_REDIRECT_URI;
	if (!clientId || !clientSecret || !redirectUri) throw new Error("ANALYTICS_NOT_CONFIGURED");
	try {
		const url = new URL(redirectUri);
		if (
			url.protocol !== "https:" &&
			!(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
		)
			throw new Error();
		if (url.username || url.password || url.hash || url.search || url.pathname !== "/api/analytics/google/callback")
			throw new Error();
		analyticsEncryptionKey();
	} catch {
		throw new Error("ANALYTICS_NOT_CONFIGURED");
	}
	return { clientId, clientSecret, redirectUri };
}

export function analyticsConfigured(): boolean {
	try {
		analyticsOAuthConfig();
		return true;
	} catch {
		return false;
	}
}

export async function requireTrafficAccess(brandId: string, manage = false) {
	const session = await requireAuthSession();
	if (manage) await requireOrgManageAccess(session.user.id, brandId);
	else await requireOrgAccess(session.user.id, brandId);
	const [brand] = await db
		.select({ id: brands.id, website: brands.website, additionalDomains: brands.additionalDomains })
		.from(brands)
		.where(eq(brands.id, brandId))
		.limit(1);
	if (!brand) throw new Error("TRAFFIC_INVALID_SITE");
	const sites: string[] = [];
	for (const candidate of [brand.website, ...brand.additionalDomains]) {
		try {
			const hostname = normalizeAnalyticsHostname(candidate);
			if (!sites.includes(hostname)) sites.push(hostname);
		} catch {
			/* A legacy invalid alias must not hide the primary domain. */
		}
	}
	return { session, brand, sites };
}

export async function trafficCanManage(userId: string, brandId: string): Promise<boolean> {
	return checkOrgManageAccess(userId, brandId);
}

export async function currentTrafficConnection(brandId: string) {
	const [connection] = await db.select().from(ga4Connections).where(eq(ga4Connections.brandId, brandId)).limit(1);
	return connection;
}

const refreshing = new Map<string, Promise<string>>();

/** Refresh only on a cache miss. The official Google client owns the OAuth protocol. */
export async function trafficAccessToken(connection: typeof ga4Connections.$inferSelect): Promise<string> {
	if (connection.status !== "connected") throw new Error("ANALYTICS_RECONNECT_REQUIRED");
	const existing = refreshing.get(connection.revision);
	if (existing) return existing;
	const promise = (async () => {
		const client = createAnalyticsOAuthClient(analyticsOAuthConfig());
		const refreshToken = openAnalyticsSecret(connection.refreshTokenCiphertext, `ga4:refresh:${connection.brandId}`);
		client.setCredentials({ refresh_token: refreshToken });
		try {
			const result = await client.getAccessToken();
			if (!result.token) throw new Error("ANALYTICS_RECONNECT_REQUIRED");
			// Google may rotate refresh credentials. Store the replacement only while
			// this is still the active connection, without changing its dataset key.
			if (client.credentials.refresh_token && client.credentials.refresh_token !== refreshToken) {
				await db
					.update(ga4Connections)
					.set({
						refreshTokenCiphertext: sealAnalyticsSecret(
							client.credentials.refresh_token,
							`ga4:refresh:${connection.brandId}`,
						),
						updatedAt: new Date(),
					})
					.where(and(eq(ga4Connections.brandId, connection.brandId), eq(ga4Connections.revision, connection.revision)));
			}
			return result.token;
		} catch (error) {
			const details = error as { response?: { data?: { error?: string } }; message?: string };
			if (details.response?.data?.error === "invalid_grant" || details.message === "ANALYTICS_RECONNECT_REQUIRED") {
				await db
					.update(ga4Connections)
					.set({ status: "needs_reauth", updatedAt: new Date() })
					.where(and(eq(ga4Connections.brandId, connection.brandId), eq(ga4Connections.revision, connection.revision)));
				throw new Error("ANALYTICS_RECONNECT_REQUIRED");
			}
			throw new Error("ANALYTICS_UNAVAILABLE");
		}
	})();
	refreshing.set(connection.revision, promise);
	try {
		return await promise;
	} finally {
		refreshing.delete(connection.revision);
	}
}

export function newTrafficRevision() {
	return randomUUID();
}

export async function assertTrafficRevision(brandId: string, revision: string) {
	const connection = await currentTrafficConnection(brandId);
	if (!connection || connection.revision !== revision || connection.status !== "connected")
		throw new Error("ANALYTICS_CONNECTION_CHANGED");
}
