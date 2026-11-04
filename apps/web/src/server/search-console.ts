import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { gscConnections, gscOAuthStates, gscQueryCache } from "@workspace/lib/db/schema";
import { type GscReport, propertyMatchesHosts, reportFiltersSchema } from "@workspace/lib/search-console";
import { fetchSearchConsoleReport, listSearchConsoleSites } from "@workspace/lib/search-console/server";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { startSearchConsoleOAuth } from "./search-console-oauth";
import {
	assertSearchConsoleRevision,
	currentSearchConsoleConnection,
	markSearchConsoleReauth,
	newSearchConsoleRevision,
	requireSearchConsoleAccess,
	searchConsoleAccessToken,
	searchConsoleCacheKey,
	searchConsoleConfigured,
} from "./search-console-runtime";
import { trafficCanManage } from "./traffic-runtime";

const brandInput = z.object({ brandId: z.string().min(1).max(200) });
const pending = new Map<string, Promise<GscReport>>();
const TTL = 30 * 60_000;

async function searchConsoleStatus(brandId: string) {
	const { session, sites } = await requireSearchConsoleAccess(brandId);
	const connection = await currentSearchConsoleConnection(brandId);
	const propertyId =
		connection?.propertyId && propertyMatchesHosts(connection.propertyId, sites) ? connection.propertyId : null;
	return {
		configured: searchConsoleConfigured(),
		canManage: await trafficCanManage(session.user.id, brandId),
		oauthConnected: !!connection,
		needsReauth: connection?.status === "needs_reauth",
		propertyId,
		connectionRevision: connection?.revision ?? null,
	};
}

export const getSearchConsoleStatusFn = createServerFn({ method: "GET" })
	.validator(brandInput)
	.handler(({ data }) => searchConsoleStatus(data.brandId));
export const beginSearchConsoleOAuthFn = createServerFn({ method: "POST" })
	.validator(brandInput)
	.handler(({ data }) => startSearchConsoleOAuth(data.brandId));

export const getSearchConsolePropertiesFn = createServerFn({ method: "GET" })
	.validator(brandInput)
	.handler(async ({ data }) => {
		const { sites } = await requireSearchConsoleAccess(data.brandId, true);
		const connection = await currentSearchConsoleConnection(data.brandId);
		if (!connection) throw new Error("GSC_RECONNECT_REQUIRED");
		try {
			const properties = await listSearchConsoleSites(await searchConsoleAccessToken(connection));
			await assertSearchConsoleRevision(data.brandId, connection.revision);
			return properties.filter(
				(site) => propertyMatchesHosts(site.siteUrl, sites) && site.permissionLevel !== "siteUnverifiedUser",
			);
		} catch (error) {
			if (error instanceof Error && error.message === "GSC_RECONNECT_REQUIRED")
				await markSearchConsoleReauth(connection);
			throw error;
		}
	});

export const connectSearchConsolePropertyFn = createServerFn({ method: "POST" })
	.validator(brandInput.extend({ siteUrl: z.string().min(1).max(2048) }))
	.handler(async ({ data }) => {
		const { sites } = await requireSearchConsoleAccess(data.brandId, true);
		if (!propertyMatchesHosts(data.siteUrl, sites)) throw new Error("GSC_PROPERTY_FORBIDDEN");
		const connection = await currentSearchConsoleConnection(data.brandId);
		if (!connection) throw new Error("GSC_RECONNECT_REQUIRED");
		const properties = await listSearchConsoleSites(await searchConsoleAccessToken(connection));
		if (!properties.some((site) => site.siteUrl === data.siteUrl && site.permissionLevel !== "siteUnverifiedUser"))
			throw new Error("GSC_PROPERTY_FORBIDDEN");
		// Verify the manager still has permission after the provider request.
		await requireSearchConsoleAccess(data.brandId, true);
		await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(gscConnections)
				.set({
					propertyId: data.siteUrl,
					status: "connected",
					revision: newSearchConsoleRevision(),
					updatedAt: new Date(),
				})
				.where(and(eq(gscConnections.brandId, data.brandId), eq(gscConnections.revision, connection.revision)))
				.returning({ id: gscConnections.brandId });
			if (!updated) throw new Error("GSC_CONNECTION_CHANGED");
			await tx.delete(gscQueryCache).where(eq(gscQueryCache.brandId, data.brandId));
		});
		return searchConsoleStatus(data.brandId);
	});

export const disconnectSearchConsoleFn = createServerFn({ method: "POST" })
	.validator(brandInput)
	.handler(async ({ data }) => {
		await requireSearchConsoleAccess(data.brandId, true);
		await db.transaction(async (tx) => {
			await tx.delete(gscOAuthStates).where(eq(gscOAuthStates.brandId, data.brandId));
			await tx.delete(gscQueryCache).where(eq(gscQueryCache.brandId, data.brandId));
			await tx.delete(gscConnections).where(eq(gscConnections.brandId, data.brandId));
		});
		// Google revocation can affect grants used by other clients in the project.
		// Disconnect only this brand's local GSC credentials.
		return { disconnected: true };
	});

async function searchConsoleReport(
	input: { brandId: string } & z.infer<typeof reportFiltersSchema>,
): Promise<GscReport> {
	const { sites } = await requireSearchConsoleAccess(input.brandId);
	const connection = await currentSearchConsoleConnection(input.brandId);
	if (connection?.status !== "connected") throw new Error("GSC_RECONNECT_REQUIRED");
	if (!connection.propertyId) throw new Error("GSC_PROPERTY_REQUIRED");
	if (!propertyMatchesHosts(connection.propertyId, sites)) throw new Error("GSC_PROPERTY_FORBIDDEN");
	const filters = reportFiltersSchema.parse(input);
	const key = searchConsoleCacheKey(connection, sites, filters);
	const [cached] = await db
		.select()
		.from(gscQueryCache)
		.where(
			and(
				eq(gscQueryCache.cacheKey, key),
				eq(gscQueryCache.brandId, input.brandId),
				eq(gscQueryCache.connectionRevision, connection.revision),
				gt(gscQueryCache.expiresAt, new Date()),
			),
		)
		.limit(1);
	if (cached) {
		await assertSearchConsoleRevision(input.brandId, connection.revision);
		await requireSearchConsoleAccess(input.brandId);
		return cached.payload as GscReport;
	}
	const existing = pending.get(key);
	if (existing) {
		const result = await existing;
		await assertSearchConsoleRevision(input.brandId, connection.revision);
		await requireSearchConsoleAccess(input.brandId);
		return result;
	}
	const promise = (async () => {
		try {
			const result = await fetchSearchConsoleReport(
				await searchConsoleAccessToken(connection),
				connection.propertyId as string,
				sites,
				filters,
			);
			await assertSearchConsoleRevision(input.brandId, connection.revision);
			await db
				.insert(gscQueryCache)
				.values({
					cacheKey: key,
					brandId: input.brandId,
					connectionRevision: connection.revision,
					payload: result,
					fetchedAt: new Date(result.fetchedAt),
					expiresAt: new Date(Date.now() + TTL),
				})
				.onConflictDoUpdate({
					target: gscQueryCache.cacheKey,
					set: { payload: result, fetchedAt: new Date(result.fetchedAt), expiresAt: new Date(Date.now() + TTL) },
				});
			try {
				await assertSearchConsoleRevision(input.brandId, connection.revision);
				await requireSearchConsoleAccess(input.brandId);
			} catch (error) {
				await db.delete(gscQueryCache).where(eq(gscQueryCache.cacheKey, key));
				throw error;
			}
			await db
				.delete(gscQueryCache)
				.where(and(eq(gscQueryCache.brandId, input.brandId), lt(gscQueryCache.expiresAt, new Date())));
			return result;
		} catch (error) {
			if (error instanceof Error && error.message === "GSC_RECONNECT_REQUIRED")
				await markSearchConsoleReauth(connection);
			throw error;
		}
	})();
	pending.set(key, promise);
	try {
		return await promise;
	} finally {
		pending.delete(key);
	}
}

export const getSearchConsoleReportFn = createServerFn({ method: "GET" })
	.validator(reportFiltersSchema.safeExtend(brandInput.shape))
	.handler(({ data }) => searchConsoleReport(data));
