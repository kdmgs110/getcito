import { createServerFn } from "@tanstack/react-start";
import {
	type ConversionGoal,
	type ConversionReport,
	conversionRequestSchema,
	type GA4KeyEvent,
	normalizeConditions,
} from "@workspace/lib/analytics";
import { fetchConversionReport, listGA4KeyEvents } from "@workspace/lib/analytics/conversions-server";
import { db } from "@workspace/lib/db/db";
import { conversionGoals, ga4Connections, trafficQueryCache } from "@workspace/lib/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { conversionReportCacheKey } from "./conversion-cache";
import {
	assertTrafficRevision,
	currentTrafficConnection,
	requireTrafficAccess,
	trafficAccessToken,
} from "./traffic-runtime";
import { resolveTrafficHosts } from "./traffic-scope";

const brandInput = z.object({ brandId: z.string().min(1).max(200) });
const scopedBrandInput = brandInput.extend({ hostname: z.string().min(1).max(253).optional() });
const goalInput = scopedBrandInput.extend({
	id: z.string().uuid().optional(),
	revision: z.number().int().positive().optional(),
	displayName: z.string().trim().min(1).max(60),
	eventName: z.string().trim().min(1).max(200),
	enabled: z.boolean(),
});
const TTL = 30 * 60_000;
const pending = new Map<string, Promise<ConversionReport>>();
type GoalRow = typeof conversionGoals.$inferSelect;
type Connection = typeof ga4Connections.$inferSelect & { propertyId: string; hostname: string };

export function conversionProviderError(error: unknown): Error {
	const details = (error ?? {}) as { message?: string; code?: string };
	if (details.message && /^(?:ANALYTICS|TRAFFIC|CONVERSION)_[A-Z_]+$/.test(details.message))
		return new Error(details.message);
	const codes: Record<string, string> = {
		auth_revoked: "ANALYTICS_RECONNECT_REQUIRED",
		forbidden: "ANALYTICS_FORBIDDEN",
		quota: "ANALYTICS_QUOTA",
		invalid_request: "TRAFFIC_INVALID_REQUEST",
		unsupported_site: "ANALYTICS_UNSUPPORTED_SITE",
		site_mismatch: "TRAFFIC_INVALID_SITE",
		report_too_large: "ANALYTICS_REPORT_TOO_LARGE",
	};
	return new Error(codes[details.code ?? ""] ?? "ANALYTICS_UNAVAILABLE");
}
function asGoal(row: GoalRow): ConversionGoal {
	return {
		id: row.id,
		brandId: row.brandId,
		propertyId: row.propertyId,
		hostname: row.hostname,
		eventName: row.eventName,
		displayName: row.displayName,
		enabled: row.enabled,
		revision: row.revision,
		ga4Name: row.ga4Name,
		ga4CreateTime: row.ga4CreateTime?.toISOString() ?? null,
		countingMethod: row.countingMethod,
		updatedAt: row.updatedAt.toISOString(),
	};
}
async function context(brandId: string, manage = false) {
	const access = await requireTrafficAccess(brandId, manage);
	const connection = await currentTrafficConnection(brandId);
	if (!connection?.propertyId || !connection.hostname || connection.status !== "connected")
		throw new Error("ANALYTICS_RECONNECT_REQUIRED");
	if (!access.sites.includes(connection.hostname)) throw new Error("TRAFFIC_INVALID_SITE");
	return { ...access, connection: connection as Connection };
}
function scope(connection: Connection) {
	return and(
		eq(conversionGoals.brandId, connection.brandId),
		eq(conversionGoals.propertyId, connection.propertyId),
		eq(conversionGoals.hostname, connection.hostname),
	);
}
async function getGoal(connection: Connection, id: string, hosts = [connection.hostname]): Promise<GoalRow> {
	const [goal] = await db
		.select()
		.from(conversionGoals)
		.where(
			and(
				eq(conversionGoals.brandId, connection.brandId),
				eq(conversionGoals.propertyId, connection.propertyId),
				inArray(conversionGoals.hostname, hosts),
				eq(conversionGoals.id, id),
			),
		)
		.limit(1);
	if (!goal) throw new Error("CONVERSION_GOAL_NOT_FOUND");
	return goal;
}
async function reportGoals(
	connection: Connection,
	allowed: string[],
	hosts: string[],
	goalId: string,
): Promise<GoalRow[]> {
	let eventName: string | undefined;
	if (goalId !== "all") {
		const selected = await getGoal(connection, goalId, allowed);
		if (!selected.enabled) throw new Error("CONVERSION_GOAL_DISABLED");
		if (hosts.length === 1 && selected.hostname === hosts[0]) return [selected];
		eventName = selected.eventName;
	}
	const goals = await db
		.select()
		.from(conversionGoals)
		.where(
			and(
				eq(conversionGoals.brandId, connection.brandId),
				eq(conversionGoals.propertyId, connection.propertyId),
				inArray(conversionGoals.hostname, hosts),
				eq(conversionGoals.enabled, true),
				...(eventName ? [eq(conversionGoals.eventName, eventName)] : []),
			),
		)
		.orderBy(asc(conversionGoals.id));
	if (!goals.length) throw new Error("CONVERSION_GOAL_NOT_FOUND");
	return goals;
}
function goalSnapshot(goals: GoalRow[]): string {
	return JSON.stringify(
		goals
			.map((goal) => [goal.id, goal.revision, goal.hostname, goal.eventName, goal.enabled])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	);
}
async function assertGoals(
	connection: Connection,
	allowed: string[],
	hosts: string[],
	goalId: string,
	goals: GoalRow[],
) {
	await assertTrafficRevision(connection.brandId, connection.revision);
	const current = await reportGoals(connection, allowed, hosts, goalId);
	if (goalSnapshot(current) !== goalSnapshot(goals)) throw new Error("CONVERSION_GOAL_CONFLICT");
}
async function keyEvents(connection: Connection): Promise<GA4KeyEvent[]> {
	const events = await listGA4KeyEvents(await trafficAccessToken(connection), connection.propertyId);
	await assertTrafficRevision(connection.brandId, connection.revision);
	return events;
}
function uniqueViolation(error: unknown): boolean {
	let cause = error as { code?: string; cause?: unknown } | undefined;
	for (let depth = 0; cause && depth < 5; depth++) {
		if (cause.code === "23505") return true;
		cause = cause.cause as typeof cause;
	}
	return false;
}
export const listConversionGoalsFn = createServerFn({ method: "GET" })
	.validator(scopedBrandInput)
	.handler(async ({ data }): Promise<ConversionGoal[]> => {
		const { connection, sites } = await context(data.brandId);
		const hosts = resolveTrafficHosts(sites, data.hostname);
		const goals = await db
			.select()
			.from(conversionGoals)
			.where(
				and(
					eq(conversionGoals.brandId, connection.brandId),
					eq(conversionGoals.propertyId, connection.propertyId),
					inArray(conversionGoals.hostname, hosts),
				),
			)
			.orderBy(asc(conversionGoals.createdAt), asc(conversionGoals.id));
		await assertTrafficRevision(data.brandId, connection.revision);
		return goals.map(asGoal);
	});
export const listConversionEventsFn = createServerFn({ method: "GET" })
	.validator(brandInput)
	.handler(async ({ data }): Promise<GA4KeyEvent[]> => {
		const { connection } = await context(data.brandId, true);
		try {
			return await keyEvents(connection);
		} catch (error) {
			throw conversionProviderError(error);
		}
	});
export const saveConversionGoalFn = createServerFn({ method: "POST" })
	.validator(goalInput)
	.handler(async ({ data }): Promise<ConversionGoal> => {
		const { connection: activeConnection, session, sites } = await context(data.brandId, true);
		const [hostname] = resolveTrafficHosts(sites, data.hostname ?? activeConnection.hostname);
		if (data.hostname === "all") throw new Error("TRAFFIC_INVALID_SITE");
		const connection = { ...activeConnection, hostname };
		if (data.id && !data.revision) throw new Error("CONVERSION_GOAL_CONFLICT");
		try {
			const existing = data.id ? await getGoal(connection, data.id) : undefined;
			if (existing && existing.revision !== data.revision) throw new Error("CONVERSION_GOAL_CONFLICT");
			const event =
				!data.enabled && existing && existing.eventName === data.eventName
					? {
							name: existing.ga4Name,
							eventName: existing.eventName,
							createTime: existing.ga4CreateTime?.toISOString() ?? null,
							countingMethod: existing.countingMethod,
						}
					: (await keyEvents(connection)).find((event) => event.eventName === data.eventName);
			if (!event) throw new Error("CONVERSION_EVENT_MISSING");
			const displayName = data.displayName.normalize("NFKC").trim().replace(/\s+/g, " ");
			if (!displayName || displayName.length > 60) throw new Error("TRAFFIC_INVALID_REQUEST");
			const result = await db.transaction(async (tx) => {
				// Lock the current connection through the write; a reconnect/disconnect must
				// wait instead of attaching a goal to a superseded property snapshot.
				const [locked] = await tx
					.select({ brandId: ga4Connections.brandId })
					.from(ga4Connections)
					.where(
						and(
							eq(ga4Connections.brandId, data.brandId),
							eq(ga4Connections.revision, connection.revision),
							eq(ga4Connections.status, "connected"),
							eq(ga4Connections.propertyId, connection.propertyId),
							eq(ga4Connections.hostname, activeConnection.hostname),
						),
					)
					.for("update");
				if (!locked) throw new Error("ANALYTICS_CONNECTION_CHANGED");
				const values = {
					displayName,
					eventName: data.eventName,
					enabled: data.enabled,
					ga4Name: event.name,
					ga4CreateTime: event.createTime ? new Date(event.createTime) : null,
					countingMethod: event.countingMethod,
					updatedBy: session.user.id,
					updatedAt: new Date(),
				};
				let saved: GoalRow | undefined;
				if (data.id) {
					if (!data.revision) throw new Error("CONVERSION_GOAL_CONFLICT");
					[saved] = await tx
						.update(conversionGoals)
						.set({ ...values, revision: sql`${conversionGoals.revision} + 1` })
						.where(and(scope(connection), eq(conversionGoals.id, data.id), eq(conversionGoals.revision, data.revision)))
						.returning();
					if (!saved) throw new Error("CONVERSION_GOAL_CONFLICT");
				} else {
					await tx.execute(
						sql`SELECT pg_advisory_xact_lock(hashtext(${`conversion-goals:${data.brandId}:${connection.propertyId}:${connection.hostname}`}))`,
					);
					const [count] = await tx
						.select({ count: sql<number>`count(*)::integer` })
						.from(conversionGoals)
						.where(scope(connection));
					if ((count?.count ?? 0) >= 100) throw new Error("CONVERSION_GOAL_LIMIT");
					[saved] = await tx
						.insert(conversionGoals)
						.values({
							...values,
							brandId: data.brandId,
							propertyId: connection.propertyId,
							hostname: connection.hostname,
							createdBy: session.user.id,
						})
						.returning();
				}
				if (!saved) throw new Error("CONVERSION_GOAL_CONFLICT");
				await tx.delete(trafficQueryCache).where(eq(trafficQueryCache.brandId, data.brandId));
				return saved;
			});
			return asGoal(result);
		} catch (error) {
			if (uniqueViolation(error)) throw new Error("CONVERSION_GOAL_DUPLICATE");
			throw conversionProviderError(error);
		}
	});

export const getConversionReportFn = createServerFn({ method: "GET" })
	.validator(conversionRequestSchema)
	.handler(async ({ data }): Promise<ConversionReport> => {
		const { connection, sites } = await context(data.brandId);
		const hosts = resolveTrafficHosts(sites, data.hostname);
		const goals = await reportGoals(connection, sites, hosts, data.goalId);
		let conditions: import("@workspace/lib/analytics").TrafficCondition[];
		try {
			conditions = normalizeConditions(data.conditions, hosts);
		} catch {
			throw new Error("TRAFFIC_INVALID_REQUEST");
		}
		const normalized = { ...data, hostname: hosts.length > 1 ? "all" : hosts[0], conditions };
		const scopedConnection = { ...connection, hostnames: hosts };
		const key = conversionReportCacheKey(scopedConnection, goals, normalized);
		const verify = () => assertGoals(connection, sites, hosts, data.goalId, goals);
		try {
			// A cached report must not turn a removed GA4 event into a misleading zero or
			// keep reporting it as active. This endpoint remains readable by members.
			const events = new Set((await keyEvents(connection)).map((event) => event.eventName));
			if (goals.some((goal) => !events.has(goal.eventName))) throw new Error("CONVERSION_EVENT_MISSING");
			const [cached] = await db
				.select()
				.from(trafficQueryCache)
				.where(
					and(
						eq(trafficQueryCache.cacheKey, key),
						eq(trafficQueryCache.brandId, data.brandId),
						eq(trafficQueryCache.connectionRevision, connection.revision),
					),
				)
				.limit(1);
			if (cached && cached.expiresAt.getTime() > Date.now()) {
				await verify();
				return cached.payload as ConversionReport;
			}
			const previous = pending.get(key);
			if (previous) {
				const report = await previous;
				await verify();
				return report;
			}
			const operation = (async () => {
				const report = await fetchConversionReport({
					...normalized,
					accessToken: await trafficAccessToken(connection),
					propertyId: connection.propertyId,
					hostname: hosts[0],
					hostnames: hosts,
					measurementMode:
						hosts.length > 1 || hosts[0] !== connection.hostname
							? "observed_session_start"
							: connection.measurementMode,
					eventName: goals[0].eventName,
					eventNames: [...new Set(goals.map((goal) => goal.eventName))],
					eventScopes: hosts
						.map((hostname) => ({
							hostname,
							eventNames: [
								...new Set(goals.filter((goal) => goal.hostname === hostname).map((goal) => goal.eventName)),
							],
						}))
						.filter((scope) => scope.eventNames.length > 0),
				});
				await verify();
				await db
					.insert(trafficQueryCache)
					.values({
						cacheKey: key,
						brandId: data.brandId,
						connectionRevision: connection.revision,
						payload: report,
						fetchedAt: new Date(report.fetchedAt),
						expiresAt: new Date(Date.now() + TTL),
					})
					.onConflictDoUpdate({
						target: trafficQueryCache.cacheKey,
						set: { payload: report, fetchedAt: new Date(report.fetchedAt), expiresAt: new Date(Date.now() + TTL) },
					});
				try {
					await verify();
				} catch (error) {
					await db.delete(trafficQueryCache).where(eq(trafficQueryCache.cacheKey, key));
					throw error;
				}
				return report;
			})();
			pending.set(key, operation);
			try {
				return await operation;
			} finally {
				pending.delete(key);
			}
		} catch (error) {
			throw conversionProviderError(error);
		}
	});
