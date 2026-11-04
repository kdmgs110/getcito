import { randomBytes } from "node:crypto";
import { createAnalyticsOAuthClient } from "@workspace/lib/analytics/server";
import { db } from "@workspace/lib/db/db";
import { session as authSessions, gscConnections, gscOAuthStates, gscQueryCache } from "@workspace/lib/db/schema";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { requireAuthSession, requireOrgManageAccess } from "@/lib/auth/helpers";
import {
	newSearchConsoleRevision,
	requireSearchConsoleAccess,
	SEARCH_CONSOLE_SCOPE,
	searchConsoleOAuthConfig,
} from "./search-console-runtime";
import { analyticsStateHash, openAnalyticsSecret, sealAnalyticsSecret } from "./traffic-security";

export async function startSearchConsoleOAuth(brandId: string): Promise<{ url: string }> {
	const { session } = await requireSearchConsoleAccess(brandId, true);
	const client = createAnalyticsOAuthClient(searchConsoleOAuthConfig());
	const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
	const state = randomBytes(32).toString("base64url");
	const stateHash = analyticsStateHash(state);
	await db.transaction(async (tx) => {
		await tx.delete(gscOAuthStates).where(lt(gscOAuthStates.expiresAt, new Date()));
		await tx
			.delete(gscOAuthStates)
			.where(
				and(
					eq(gscOAuthStates.brandId, brandId),
					eq(gscOAuthStates.userId, session.user.id),
					eq(gscOAuthStates.sessionId, session.session.id),
				),
			);
		await tx.insert(gscOAuthStates).values({
			stateHash,
			brandId,
			userId: session.user.id,
			sessionId: session.session.id,
			verifierCiphertext: sealAnalyticsSecret(codeVerifier, `gsc:pkce:${stateHash}`),
			expiresAt: new Date(Date.now() + 10 * 60_000),
		});
	});
	return {
		url: client.generateAuthUrl({
			access_type: "offline",
			prompt: "consent",
			scope: [SEARCH_CONSOLE_SCOPE],
			state,
			code_challenge: codeChallenge,
			code_challenge_method: "S256" as NonNullable<
				Parameters<typeof client.generateAuthUrl>[0]
			>["code_challenge_method"],
		}),
	};
}

function callbackResponse(brandId: string | null, status: "connected" | "error") {
	const location = brandId ? `/app/${encodeURIComponent(brandId)}/keywords?gsc=${status}` : "/app";
	return new Response(null, {
		status: 303,
		headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
	});
}

/** Errors are deliberately not logged or reflected: provider errors can include authorization codes. */
export async function finishSearchConsoleOAuth(request: Request): Promise<Response> {
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
			.update(gscOAuthStates)
			.set({ consumedAt: new Date() })
			.where(
				and(
					eq(gscOAuthStates.stateHash, stateHash),
					eq(gscOAuthStates.userId, session.user.id),
					eq(gscOAuthStates.sessionId, session.session.id),
					isNull(gscOAuthStates.consumedAt),
					gt(gscOAuthStates.expiresAt, new Date()),
				),
			)
			.returning();
		if (!stored) return callbackResponse(null, "error");
		brandId = stored.brandId;
		await requireOrgManageAccess(session.user.id, brandId);
		const code = url.searchParams.get("code");
		if (url.searchParams.has("error") || !code || code.length > 4096) return callbackResponse(brandId, "error");
		const client = createAnalyticsOAuthClient(searchConsoleOAuthConfig());
		const { tokens } = await client.getToken({
			code,
			codeVerifier: openAnalyticsSecret(stored.verifierCiphertext, `gsc:pkce:${stateHash}`),
		});
		if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(SEARCH_CONSOLE_SCOPE))
			return callbackResponse(brandId, "error");
		const refreshTokenCiphertext = sealAnalyticsSecret(tokens.refresh_token, `gsc:refresh:${stored.brandId}`);
		const revision = newSearchConsoleRevision();
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
			if (!validSession) throw new Error("GSC_FORBIDDEN");
			const [claimed] = await tx
				.delete(gscOAuthStates)
				.where(and(eq(gscOAuthStates.stateHash, stateHash), gt(gscOAuthStates.expiresAt, new Date())))
				.returning({ hash: gscOAuthStates.stateHash });
			if (!claimed) throw new Error("GSC_CONNECTION_CHANGED");
			await tx
				.insert(gscConnections)
				.values({
					brandId: stored.brandId,
					connectedBy: session.user.id,
					refreshTokenCiphertext,
					revision,
				})
				.onConflictDoUpdate({
					target: gscConnections.brandId,
					set: {
						connectedBy: session.user.id,
						refreshTokenCiphertext,
						propertyId: null,
						status: "connected",
						revision,
						updatedAt: new Date(),
					},
				});
			await tx.delete(gscQueryCache).where(eq(gscQueryCache.brandId, stored.brandId));
		});
		return callbackResponse(brandId, "connected");
	} catch {
		return callbackResponse(brandId, "error");
	}
}
