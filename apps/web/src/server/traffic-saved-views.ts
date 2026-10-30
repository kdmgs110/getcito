import { createServerFn } from "@tanstack/react-start";
import {
	FILTER_SCHEMA_VERSION,
	normalizeConditions,
	type SavedTrafficView,
	trafficConditionsSchema,
} from "@workspace/lib/analytics";
import { db } from "@workspace/lib/db/db";
import { conversionGoals, ga4Connections, trafficSavedViews } from "@workspace/lib/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { currentTrafficConnection, requireTrafficAccess } from "./traffic-runtime";
import { normalizeAnalyticsHostname } from "./traffic-security";

const brandInput = z.object({ brandId: z.string().min(1).max(200) });
const idInput = brandInput.extend({ id: z.string().uuid(), revision: z.number().int().positive() });

function asSavedView(view: typeof trafficSavedViews.$inferSelect): SavedTrafficView {
	if (view.filterSchemaVersion !== FILTER_SCHEMA_VERSION) throw new Error("TRAFFIC_VIEW_INCOMPATIBLE");
	return {
		id: view.id,
		brandId: view.brandId,
		hostname: view.hostname,
		name: view.name,
		conditions: normalizeConditions(view.conditions, view.hostname),
		sortOrder: view.sortOrder,
		revision: view.revision,
		updatedAt: view.updatedAt.toISOString(),
		conversionGoalId: view.conversionGoalId ?? null,
		analysisTab: view.analysisTab ?? "traffic",
	};
}

export function normalizedTrafficViewName(name: string): string {
	return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueViolation(error: unknown): boolean {
	let current = error as { code?: string; cause?: unknown } | undefined;
	for (let depth = 0; current && depth < 5; depth++) {
		if (current.code === "23505") return true;
		current = current.cause as typeof current;
	}
	return false;
}

export const listTrafficViewsFn = createServerFn({ method: "GET" })
	.validator(brandInput)
	.handler(async ({ data }): Promise<SavedTrafficView[]> => {
		await requireTrafficAccess(data.brandId);
		const views = await db
			.select()
			.from(trafficSavedViews)
			.where(eq(trafficSavedViews.brandId, data.brandId))
			.orderBy(asc(trafficSavedViews.sortOrder), asc(trafficSavedViews.createdAt), asc(trafficSavedViews.id));
		return views.map(asSavedView);
	});

export const saveTrafficViewFn = createServerFn({ method: "POST" })
	.validator(
		brandInput.extend({
			id: z.string().uuid().optional(),
			revision: z.number().int().positive().optional(),
			name: z.string().trim().min(1).max(60),
			hostname: z.string().min(1).max(253),
			conditions: trafficConditionsSchema,
			conversionGoalId: z
				.union([z.string().uuid(), z.literal("all")])
				.nullable()
				.optional(),
			analysisTab: z.enum(["traffic", "conversions"]).optional(),
		}),
	)
	.handler(async ({ data }): Promise<SavedTrafficView> => {
		const { session, sites } = await requireTrafficAccess(data.brandId, true);
		const hostname = normalizeAnalyticsHostname(data.hostname);
		if (!sites.includes(hostname)) throw new Error("TRAFFIC_INVALID_SITE");
		const name = data.name.normalize("NFKC").trim().replace(/\s+/g, " ");
		if (!name || name.length > 60) throw new Error("TRAFFIC_VIEW_INVALID_NAME");
		const normalizedName = normalizedTrafficViewName(name);
		const conditions = normalizeConditions(data.conditions, hostname);

		try {
			return await db.transaction(async (tx) => {
				const preferences: { conversionGoalId?: string | null; analysisTab?: "traffic" | "conversions" } = {};
				if (data.analysisTab !== undefined) preferences.analysisTab = data.analysisTab;
				if (data.conversionGoalId !== undefined) {
					preferences.conversionGoalId = data.conversionGoalId === "all" ? null : data.conversionGoalId;
					if (data.conversionGoalId && data.conversionGoalId !== "all") {
						const connection = await currentTrafficConnection(data.brandId);
						if (!connection?.propertyId || !connection.hostname || connection.status !== "connected")
							throw new Error("ANALYTICS_CONNECTION_CHANGED");
						const [locked] = await tx
							.select({ id: ga4Connections.brandId })
							.from(ga4Connections)
							.where(
								and(
									eq(ga4Connections.brandId, data.brandId),
									eq(ga4Connections.revision, connection.revision),
									eq(ga4Connections.propertyId, connection.propertyId),
									eq(ga4Connections.hostname, connection.hostname),
									eq(ga4Connections.status, "connected"),
								),
							)
							.for("share");
						if (!locked) throw new Error("ANALYTICS_CONNECTION_CHANGED");
						const [goal] = await tx
							.select({ id: conversionGoals.id })
							.from(conversionGoals)
							.where(
								and(
									eq(conversionGoals.id, data.conversionGoalId),
									eq(conversionGoals.brandId, data.brandId),
									eq(conversionGoals.propertyId, connection.propertyId),
									eq(conversionGoals.hostname, hostname),
									eq(conversionGoals.enabled, true),
								),
							)
							.for("share");
						if (!goal) throw new Error("CONVERSION_GOAL_NOT_FOUND");
					}
				}
				if (data.id) {
					if (!data.revision) throw new Error("TRAFFIC_VIEW_CONFLICT");
					const [updated] = await tx
						.update(trafficSavedViews)
						.set({
							name,
							normalizedName,
							conditions,
							...preferences,
							filterSchemaVersion: FILTER_SCHEMA_VERSION,
							revision: sql`${trafficSavedViews.revision} + 1`,
							updatedBy: session.user.id,
							updatedAt: new Date(),
						})
						.where(
							and(
								eq(trafficSavedViews.id, data.id),
								eq(trafficSavedViews.brandId, data.brandId),
								eq(trafficSavedViews.hostname, hostname),
								eq(trafficSavedViews.revision, data.revision),
							),
						)
						.returning();
					if (!updated) throw new Error("TRAFFIC_VIEW_CONFLICT");
					return asSavedView(updated);
				}
				await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`traffic-views:${data.brandId}:${hostname}`}))`);
				const [count] = await tx
					.select({
						count: sql<number>`count(*)::integer`,
						last: sql<number>`coalesce(max(${trafficSavedViews.sortOrder}), -1)::integer`,
					})
					.from(trafficSavedViews)
					.where(and(eq(trafficSavedViews.brandId, data.brandId), eq(trafficSavedViews.hostname, hostname)));
				if ((count?.count ?? 0) >= 200) throw new Error("TRAFFIC_VIEW_LIMIT");
				const [created] = await tx
					.insert(trafficSavedViews)
					.values({
						brandId: data.brandId,
						hostname,
						name,
						normalizedName,
						conditions,
						...preferences,
						filterSchemaVersion: FILTER_SCHEMA_VERSION,
						sortOrder: (count?.last ?? -1) + 1,
						createdBy: session.user.id,
						updatedBy: session.user.id,
					})
					.returning();
				return asSavedView(created);
			});
		} catch (error) {
			if (uniqueViolation(error)) throw new Error("TRAFFIC_VIEW_DUPLICATE_NAME");
			throw error;
		}
	});

export const deleteTrafficViewFn = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		await requireTrafficAccess(data.brandId, true);
		const [deleted] = await db
			.delete(trafficSavedViews)
			.where(
				and(
					eq(trafficSavedViews.brandId, data.brandId),
					eq(trafficSavedViews.id, data.id),
					eq(trafficSavedViews.revision, data.revision),
				),
			)
			.returning({ id: trafficSavedViews.id });
		if (!deleted) throw new Error("TRAFFIC_VIEW_CONFLICT");
		return { deleted: true };
	});

export const reorderTrafficViewsFn = createServerFn({ method: "POST" })
	.validator(
		brandInput.extend({
			ids: z
				.array(z.string().uuid())
				.min(1)
				.max(200)
				.refine((ids) => new Set(ids).size === ids.length),
		}),
	)
	.handler(async ({ data }) => {
		const { session } = await requireTrafficAccess(data.brandId, true);
		await db.transaction(async (tx) => {
			const existing = await tx
				.select({ id: trafficSavedViews.id, hostname: trafficSavedViews.hostname })
				.from(trafficSavedViews)
				.where(and(eq(trafficSavedViews.brandId, data.brandId), inArray(trafficSavedViews.id, data.ids)));
			if (existing.length !== data.ids.length || new Set(existing.map((view) => view.hostname)).size !== 1)
				throw new Error("TRAFFIC_VIEW_NOT_FOUND");
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${`traffic-views:${data.brandId}:${existing[0].hostname}`}))`,
			);
			const current = await tx
				.select({ id: trafficSavedViews.id })
				.from(trafficSavedViews)
				.where(and(eq(trafficSavedViews.brandId, data.brandId), eq(trafficSavedViews.hostname, existing[0].hostname)));
			if (current.length !== data.ids.length || current.some((view) => !data.ids.includes(view.id)))
				throw new Error("TRAFFIC_VIEW_CONFLICT");
			for (const [index, id] of data.ids.entries()) {
				await tx
					.update(trafficSavedViews)
					.set({
						sortOrder: index,
						revision: sql`${trafficSavedViews.revision} + 1`,
						updatedBy: session.user.id,
						updatedAt: new Date(),
					})
					.where(and(eq(trafficSavedViews.brandId, data.brandId), eq(trafficSavedViews.id, id)));
			}
		});
		return { reordered: true };
	});
