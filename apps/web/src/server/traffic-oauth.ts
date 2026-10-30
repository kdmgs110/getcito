import { randomBytes } from "node:crypto";
import { createAnalyticsOAuthClient } from "@workspace/lib/analytics/server";
import { db } from "@workspace/lib/db/db";
import { session as authSessions, ga4Connections, ga4OAuthStates, trafficQueryCache } from "@workspace/lib/db/schema";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { requireAuthSession, requireOrgManageAccess } from "@/lib/auth/helpers";
import { ANALYTICS_SCOPE, analyticsOAuthConfig, newTrafficRevision, requireTrafficAccess } from "./traffic-runtime";
import { analyticsStateHash, openAnalyticsSecret, sealAnalyticsSecret } from "./traffic-security";

export async function startTrafficOAuth(brandId: string): Promise<{ url: string }> {
	const { session } = await requireTrafficAccess(brandId, true);
	const client = createAnalyticsOAuthClient(analyticsOAuthConfig());
	const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
	const state = randomBytes(32).toString("base64url");
	const stateHash = analyticsStateHash(state);
	await db.transaction(async (tx) => {
		await tx.delete(ga4OAuthStates).where(lt(ga4OAuthStates.expiresAt, new Date()));
		await tx
			.delete(ga4OAuthStates)
			.where(
				and(
					eq(ga4OAuthStates.brandId, brandId),
					eq(ga4OAuthStates.userId, session.user.id),
					eq(ga4OAuthStates.sessionId, session.session.id),
				),
			);
		await tx.insert(ga4OAuthStates).values({
			stateHash,
			brandId,
			userId: session.user.id,
			sessionId: session.session.id,
			verifierCiphertext: sealAnalyticsSecret(codeVerifier, `ga4:pkce:${stateHash}`),
			expiresAt: new Date(Date.now() + 10 * 60_000),
		});
	});
	return {
		url: client.generateAuthUrl({
			access_type: "offline",
			prompt: "consent",
			scope: [ANALYTICS_SCOPE],
			state,
			code_challenge: codeChallenge,
			code_challenge_method: "S256" as NonNullable<
				Parameters<typeof client.generateAuthUrl>[0]
			>["code_challenge_method"],
		}),
	};
}

function callbackResponse(brandId: string | null, status: "connected" | "error") {
	const location = brandId ? `/app/${encodeURIComponent(brandId)}/traffic?ga4=${status}` : "/app";
	return new Response(null, {
		status: 303,
		headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
	});
}

/** Errors are deliberately not logged or reflected: provider errors can include authorization codes. */
export async function finishTrafficOAuth(request: Request): Promise<Response> {
	let brandId: string | null = null;
	try {
		const url = new URL(request.url);
		const state = url.searchParams.get("state");
		if (!state || !/^[A-Za-z\d_-]{43}$/.test(state)) return callbackResponse(null, "error");
		const session = await requireAuthSession();
		const stateHash = analyticsStateHash(state);
		// Atomic claim prevents replay. Keep the claimed row until commit so a
		// disconnect or newer OAuth attempt can invalidate an in-flight exchange.
		const [stored] = await db
			.update(ga4OAuthStates)
			.set({ consumedAt: new Date() })
			.where(
				and(
					eq(ga4OAuthStates.stateHash, stateHash),
					eq(ga4OAuthStates.userId, session.user.id),
					eq(ga4OAuthStates.sessionId, session.session.id),
					isNull(ga4OAuthStates.consumedAt),
					gt(ga4OAuthStates.expiresAt, new Date()),
				),
			)
			.returning();
		if (!stored) return callbackResponse(null, "error");
		brandId = stored.brandId;
		await requireOrgManageAccess(session.user.id, brandId);
		const code = url.searchParams.get("code");
		if (url.searchParams.has("error") || !code || code.length > 4096) return callbackResponse(brandId, "error");
		const client = createAnalyticsOAuthClient(analyticsOAuthConfig());
		const { tokens } = await client.getToken({
			code,
			codeVerifier: openAnalyticsSecret(stored.verifierCiphertext, `ga4:pkce:${stateHash}`),
		});
		if (!tokens.refresh_token || (tokens.scope && !tokens.scope.split(" ").includes(ANALYTICS_SCOPE)))
			return callbackResponse(brandId, "error");
		const refreshTokenCiphertext = sealAnalyticsSecret(tokens.refresh_token, `ga4:refresh:${stored.brandId}`);
		const revision = newTrafficRevision();
		await requireOrgManageAccess(session.user.id, brandId);
		await db.transaction(async (tx) => {
			const [validSession] = await tx
				.select({ id: authSessions.id })
				.from(authSessions)
				.where(
					and(
						eq(authSessions.id, session.session.id),
						eq(authSessions.userId, session.user.id),
						gt(authSessions.expiresAt, new Date()),
					),
				)
				.limit(1);
			if (!validSession) throw new Error("ANALYTICS_FORBIDDEN");
			const [claimed] = await tx
				.delete(ga4OAuthStates)
				.where(and(eq(ga4OAuthStates.stateHash, stateHash), gt(ga4OAuthStates.expiresAt, new Date())))
				.returning({ hash: ga4OAuthStates.stateHash });
			if (!claimed) throw new Error("ANALYTICS_CONNECTION_CHANGED");
			await tx
				.insert(ga4Connections)
				.values({
					brandId: stored.brandId,
					connectedBy: session.user.id,
					refreshTokenCiphertext,
					revision,
				})
				.onConflictDoUpdate({
					target: ga4Connections.brandId,
					set: {
						connectedBy: session.user.id,
						refreshTokenCiphertext,
						propertyId: null,
						propertyName: null,
						hostname: null,
						timeZone: "UTC",
						measurementMode: "landing_sessions",
						status: "connected",
						revision,
						updatedAt: new Date(),
					},
				});
			await tx.delete(trafficQueryCache).where(eq(trafficQueryCache.brandId, stored.brandId));
		});
		return callbackResponse(brandId, "connected");
	} catch {
		return callbackResponse(brandId, "error");
	}
}
