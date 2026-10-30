import { createServerFn } from "@tanstack/react-start";
import {
	type AnalyticsMeasurementMode,
	type AnalyticsPropertySummary,
	normalizeConditions,
	type TrafficConnectionStatus,
	type TrafficOverview,
	type TrafficPages,
	trafficPagesRequestSchema,
	trafficRequestSchema,
} from "@workspace/lib/analytics";
import {
	createAnalyticsOAuthClient,
	fetchTrafficOverview,
	fetchTrafficPages,
	getAnalyticsProperty,
	listAnalyticsPropertySummaries,
	verifyAnalyticsPropertySite,
} from "@workspace/lib/analytics/server";
import { db } from "@workspace/lib/db/db";
import { ga4Connections, ga4OAuthStates, trafficQueryCache } from "@workspace/lib/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { startTrafficOAuth } from "./traffic-oauth";
import {
	analyticsConfigured,
	analyticsOAuthConfig,
	assertTrafficRevision,
	currentTrafficConnection,
	newTrafficRevision,
	requireTrafficAccess,
	trafficAccessToken,
	trafficCanManage,
} from "./traffic-runtime";
import { resolveTrafficHosts } from "./traffic-scope";
import { normalizeAnalyticsHostname, openAnalyticsSecret, trafficCacheKey } from "./traffic-security";

const brandInput = z.object({ brandId: z.string().min(1).max(200) });
const pending = new Map<string, Promise<TrafficOverview | TrafficPages>>();
const TTL = 30 * 60_000;

async function trafficConnectionStatus(brandId: string): Promise<TrafficConnectionStatus> {
	const { session, sites } = await requireTrafficAccess(brandId);
	const connection = await currentTrafficConnection(brandId);
	return {
		configured: analyticsConfigured(),
		connected: !!(
			connection?.propertyId &&
			connection.hostname &&
			sites.includes(connection.hostname) &&
			connection.status === "connected"
		),
		oauthConnected: !!connection,
		canManage: await trafficCanManage(session.user.id, brandId),
		needsReconnect: connection?.status === "needs_reauth",
		userId: session.user.id,
		hostname: connection?.hostname ?? sites[0] ?? "",
		availableSites: sites,
		propertyId: connection?.propertyId ?? null,
		propertyName: connection?.propertyName ?? null,
		connectionRevision: connection?.revision ?? null,
		timeZone: connection?.timeZone ?? "UTC",
		measurementMode: connection?.measurementMode ?? "landing_sessions",
	};
}

export const getTrafficConnectionFn = createServerFn({ method: "GET" })
	.validator(brandInput)
	.handler(({ data }) => trafficConnectionStatus(data.brandId));

export const beginTrafficOAuthFn = createServerFn({ method: "POST" })
	.validator(brandInput)
	.handler(({ data }) => startTrafficOAuth(data.brandId));

export const getAnalyticsPropertiesFn = createServerFn({ method: "GET" })
	.validator(brandInput)
	.handler(async ({ data }): Promise<AnalyticsPropertySummary[]> => {
		await requireTrafficAccess(data.brandId, true);
		const connection = await currentTrafficConnection(data.brandId);
		if (!connection) throw new Error("ANALYTICS_RECONNECT_REQUIRED");
		try {
			return await listAnalyticsPropertySummaries(await trafficAccessToken(connection));
		} catch (error) {
			throw trafficProviderError(error);
		}
	});

export const connectTrafficPropertyFn = createServerFn({ method: "POST" })
	.validator(brandInput.extend({ propertyId: z.string().regex(/^\d{1,20}$/), hostname: z.string().min(1).max(253) }))
	.handler(async ({ data }) => {
		const { sites } = await requireTrafficAccess(data.brandId, true);
		const hostname = normalizeAnalyticsHostname(data.hostname);
		if (!sites.includes(hostname)) throw new Error("TRAFFIC_INVALID_SITE");
		const connection = await currentTrafficConnection(data.brandId);
		if (!connection) throw new Error("ANALYTICS_RECONNECT_REQUIRED");
		try {
			const token = await trafficAccessToken(connection);
			const property = await getAnalyticsProperty(token, data.propertyId);
			const measurementMode = await verifyAnalyticsPropertySite(token, data.propertyId, hostname);
			await db.transaction(async (tx) => {
				const [updated] = await tx
					.update(ga4Connections)
					.set({
						propertyId: property.id,
						propertyName: property.name,
						hostname,
						timeZone: property.timeZone,
						measurementMode,
						status: "connected",
						revision: newTrafficRevision(),
						updatedAt: new Date(),
					})
					.where(and(eq(ga4Connections.brandId, data.brandId), eq(ga4Connections.revision, connection.revision)))
					.returning({ id: ga4Connections.brandId });
				if (!updated) throw new Error("ANALYTICS_CONNECTION_CHANGED");
				await tx.delete(trafficQueryCache).where(eq(trafficQueryCache.brandId, data.brandId));
			});
		} catch (error) {
			throw trafficProviderError(error);
		}
		return trafficConnectionStatus(data.brandId);
	});

export const disconnectTrafficFn = createServerFn({ method: "POST" })
	.validator(brandInput)
	.handler(async ({ data }) => {
		await requireTrafficAccess(data.brandId, true);
		const connection = await currentTrafficConnection(data.brandId);
		await db.transaction(async (tx) => {
			await tx.delete(ga4OAuthStates).where(eq(ga4OAuthStates.brandId, data.brandId));
			await tx.delete(trafficQueryCache).where(eq(trafficQueryCache.brandId, data.brandId));
			await tx.delete(ga4Connections).where(eq(ga4Connections.brandId, data.brandId));
		});
		if (connection) {
			try {
				const client = createAnalyticsOAuthClient(analyticsOAuthConfig());
				await client.revokeToken(openAnalyticsSecret(connection.refreshTokenCiphertext, `ga4:refresh:${data.brandId}`));
			} catch {
				/* Local credentials were removed even if Google cannot be reached. */
			}
		}
		return { disconnected: true };
	});

export function trafficProviderError(error: unknown): Error {
	const e = error as { code?: string; message?: string };
	if (e.message && /^(ANALYTICS_|TRAFFIC_)[A-Z_]+$/.test(e.message)) return new Error(e.message);
	const codes: Record<string, string> = {
		auth_revoked: "ANALYTICS_RECONNECT_REQUIRED",
		forbidden: "ANALYTICS_FORBIDDEN",
		quota: "ANALYTICS_QUOTA",
		invalid_request: "TRAFFIC_INVALID_REQUEST",
		unsupported_site: "ANALYTICS_UNSUPPORTED_SITE",
		site_mismatch: "TRAFFIC_INVALID_SITE",
		upstream: "ANALYTICS_UNAVAILABLE",
		report_too_large: "ANALYTICS_REPORT_TOO_LARGE",
	};
	return new Error(codes[e.code ?? ""] ?? "ANALYTICS_UNAVAILABLE");
}

async function cachedTraffic<T extends TrafficOverview | TrafficPages>(
	kind: "overview" | "pages" | "detail",
	input: {
		brandId: string;
		from: string;
		to: string;
		conditions: import("@workspace/lib/analytics").TrafficCondition[];
		hostname?: string;
		detailHostname?: string;
		[key: string]: unknown;
	},
	load: (
		accessToken: string,
		propertyId: string,
		hostname: string,
		conditions: import("@workspace/lib/analytics").TrafficCondition[],
		measurementMode: AnalyticsMeasurementMode,
		hostnames: string[],
	) => Promise<T>,
): Promise<T> {
	const { sites } = await requireTrafficAccess(input.brandId);
	const connection = await currentTrafficConnection(input.brandId);
	if (!connection?.propertyId || !connection.hostname || connection.status !== "connected")
		throw new Error("ANALYTICS_RECONNECT_REQUIRED");
	if (!sites.includes(connection.hostname)) throw new Error("TRAFFIC_INVALID_SITE");
	const propertyId = connection.propertyId;
	const hostnames = resolveTrafficHosts(sites, input.hostname, kind === "detail" ? input.detailHostname : undefined);
	const hostname = hostnames[0];
	const measurementMode =
		hostnames.length > 1 || hostname !== connection.hostname
			? "observed_session_start"
			: (connection.measurementMode ?? "landing_sessions");
	let conditions: import("@workspace/lib/analytics").TrafficCondition[];
	try {
		conditions = normalizeConditions(input.conditions, hostnames);
	} catch {
		throw new Error("TRAFFIC_INVALID_REQUEST");
	}
	const normalizedInput = { ...input, hostname: hostnames.length > 1 ? "all" : hostname, hostnames, conditions };
	const key = trafficCacheKey(
		kind,
		{
			brandId: connection.brandId,
			revision: connection.revision,
			propertyId: connection.propertyId,
			hostname: connection.hostname,
			measurementMode,
		},
		normalizedInput,
	);
	const [cached] = await db
		.select()
		.from(trafficQueryCache)
		.where(
			and(
				eq(trafficQueryCache.cacheKey, key),
				eq(trafficQueryCache.brandId, input.brandId),
				eq(trafficQueryCache.connectionRevision, connection.revision),
			),
		)
		.limit(1);
	if (cached && cached.expiresAt.getTime() > Date.now()) {
		await assertTrafficRevision(input.brandId, connection.revision);
		return cached.payload as T;
	}
	const existing = pending.get(key);
	if (existing) return existing as Promise<T>;
	const promise = (async () => {
		try {
			const result = await load(
				await trafficAccessToken(connection),
				propertyId,
				hostname,
				conditions,
				measurementMode,
				hostnames,
			);
			await assertTrafficRevision(input.brandId, connection.revision);
			await db
				.insert(trafficQueryCache)
				.values({
					cacheKey: key,
					brandId: input.brandId,
					connectionRevision: connection.revision,
					payload: result,
					fetchedAt: new Date(result.fetchedAt),
					expiresAt: new Date(Date.now() + TTL),
				})
				.onConflictDoUpdate({
					target: trafficQueryCache.cacheKey,
					set: { payload: result, fetchedAt: new Date(result.fetchedAt), expiresAt: new Date(Date.now() + TTL) },
				});
			// A disconnect can race the insert. Recheck before returning and purge it.
			try {
				await assertTrafficRevision(input.brandId, connection.revision);
			} catch (error) {
				await db.delete(trafficQueryCache).where(eq(trafficQueryCache.cacheKey, key));
				throw error;
			}
			await db
				.delete(trafficQueryCache)
				.where(
					and(
						eq(trafficQueryCache.brandId, input.brandId),
						lt(trafficQueryCache.expiresAt, new Date(Date.now() - 7 * 24 * 60 * 60_000)),
					),
				);
			return result;
		} catch (error) {
			const safe = trafficProviderError(error);
			if (safe.message === "ANALYTICS_RECONNECT_REQUIRED") {
				await db
					.update(ga4Connections)
					.set({ status: "needs_reauth", updatedAt: new Date() })
					.where(and(eq(ga4Connections.brandId, input.brandId), eq(ga4Connections.revision, connection.revision)));
			}
			if (cached && ["ANALYTICS_UNAVAILABLE", "ANALYTICS_QUOTA"].includes(safe.message)) {
				await assertTrafficRevision(input.brandId, connection.revision);
				const previous = cached.payload as T;
				return { ...previous, warnings: [...previous.warnings, "stale_cache"] };
			}
			throw safe;
		}
	})();
	pending.set(key, promise);
	try {
		return await promise;
	} finally {
		pending.delete(key);
	}
}

export const getTrafficOverviewFn = createServerFn({ method: "GET" })
	.validator(trafficRequestSchema)
	.handler(
		({ data }): Promise<TrafficOverview> =>
			cachedTraffic("overview", data, (accessToken, propertyId, hostname, conditions, measurementMode, hostnames) =>
				fetchTrafficOverview({
					accessToken,
					propertyId,
					hostname,
					hostnames,
					from: data.from,
					to: data.to,
					conditions,
					measurementMode,
				}),
			),
	);

export const getTrafficPagesFn = createServerFn({ method: "GET" })
	.validator(trafficPagesRequestSchema)
	.handler(
		({ data }): Promise<TrafficPages> =>
			cachedTraffic("pages", data, (accessToken, propertyId, hostname, conditions, measurementMode, hostnames) =>
				fetchTrafficPages({
					accessToken,
					propertyId,
					hostname,
					hostnames,
					from: data.from,
					to: data.to,
					conditions,
					measurementMode,
					page: data.page,
					pageSize: data.pageSize,
					pageSearch: data.pageSearch,
					pageScope: data.pageScope,
				}),
			),
	);

export const getTrafficPageDetailFn = createServerFn({ method: "GET" })
	.validator(trafficRequestSchema.safeExtend({ path: z.string().min(1).max(2048) }))
	.handler(
		({ data }): Promise<TrafficOverview> =>
			cachedTraffic("detail", data, (accessToken, propertyId, hostname, conditions, measurementMode, hostnames) => {
				let exact: import("@workspace/lib/analytics").TrafficCondition[];
				try {
					exact = normalizeConditions([{ mode: "include", operator: "exact", value: data.path }], hostnames);
				} catch {
					throw new Error("TRAFFIC_INVALID_REQUEST");
				}
				return fetchTrafficOverview({
					accessToken,
					propertyId,
					hostname,
					hostnames,
					from: data.from,
					to: data.to,
					conditions: [...conditions, ...exact],
					measurementMode,
				});
			}),
	);
