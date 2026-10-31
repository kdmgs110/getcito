/**
 * Server functions for admin operations.
 * Replaces apps/web/src/app/api/admin/* API routes.
 */
import { createServerFn } from "@tanstack/react-start";
import { FIRST_RUN_JOB_PRIORITY, getDefaultDelayHours } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { brands, member, promptRuns, prompts, providerCalls, user } from "@workspace/lib/db/schema";
import { analyzeBrand } from "@workspace/lib/onboarding";
import { parseScrapeTargets } from "@workspace/lib/providers";
import { and, desc, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { z } from "zod";
import { APP_TIMEZONE } from "@/lib/app-locale";
import { isAdmin, requireAuthSession } from "@/lib/auth/helpers";
import { sendImmediatePromptJob } from "@/lib/job-scheduler";
import { getAdminActiveBrandsOverTime, getAdminBrandRunStats, getAdminRunsOverTime } from "@/lib/postgres-read";
import { compareQueueOrder } from "@/lib/queue-order";
import { deleteBrandCascade } from "@/server/brand-cascade";
import { onboardingLocaleSchemaFields } from "@/server/onboarding-locale-schema";

// ============================================================================
// Admin guard helper
// ============================================================================

async function requireAdmin() {
	const session = await requireAuthSession();
	if (!isAdmin(session)) throw new Error("Unauthorized: Admin access required");
	return session;
}

// ============================================================================
// Postgres client helper for pg-boss queries
// ============================================================================

async function withPgClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is required");
	}
	const client = new Client({ connectionString });
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end();
	}
}

// ============================================================================
// Admin Dashboard - Brand Stats
// ============================================================================

/**
 * Get admin dashboard statistics (all brands, run counts, time series charts).
 */
export const getAdminStatsFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();

	const sevenDaysAgo = new Date();
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const [allBrands, brandsOverTime, promptsData, runsOverTimeData, brandRunStats, activeBrandsData] = await Promise.all(
		[
			db.query.brands.findMany({ orderBy: desc(brands.createdAt) }),

			// Cumulative brand count over time (last 30 days)
			db
				.select({
					date: sql<string>`date_series::date`,
					count: sql<number>`COUNT(${brands.id})::int`,
				})
				.from(
					sql`generate_series(
					(NOW() AT TIME ZONE ${APP_TIMEZONE})::date - INTERVAL '30 days',
					(NOW() AT TIME ZONE ${APP_TIMEZONE})::date,
					INTERVAL '1 day'
				) AS date_series`,
				)
				.leftJoin(brands, sql`(${brands.createdAt} AT TIME ZONE ${APP_TIMEZONE})::date <= date_series::date`)
				.groupBy(sql`date_series`)
				.orderBy(sql`date_series`),

			// Cumulative prompts count over time (enabled vs disabled)
			db
				.select({
					date: sql<string>`date_series::date`,
					enabled: sql<number>`COUNT(*) FILTER (WHERE ${prompts.enabled} = true)::int`,
					disabled: sql<number>`COUNT(*) FILTER (WHERE ${prompts.enabled} = false)::int`,
				})
				.from(
					sql`generate_series(
					(NOW() AT TIME ZONE ${APP_TIMEZONE})::date - INTERVAL '30 days',
					(NOW() AT TIME ZONE ${APP_TIMEZONE})::date,
					INTERVAL '1 day'
				) AS date_series`,
				)
				.leftJoin(prompts, sql`(${prompts.createdAt} AT TIME ZONE ${APP_TIMEZONE})::date <= date_series::date`)
				.groupBy(sql`date_series`)
				.orderBy(sql`date_series`),

			getAdminRunsOverTime(),
			getAdminBrandRunStats(),
			getAdminActiveBrandsOverTime(),
		],
	);

	const brandRunStatsMap = new Map(brandRunStats.map((stat) => [stat.brand_id, stat]));

	const brandMembersQuery = await db
		.select({
			brandId: member.organizationId,
			email: user.email,
			name: user.name,
			role: member.role,
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id));

	const brandCreators = new Map<string, { email: string; name: string }>();
	for (const m of brandMembersQuery) {
		if (!brandCreators.has(m.brandId) || m.role === "owner" || m.role === "admin") {
			brandCreators.set(m.brandId, { email: m.email, name: m.name });
		}
	}

	const brandStats = await Promise.all(
		allBrands.map(async (brand) => {
			const promptCounts = await db
				.select({
					total: sql<number>`count(*)::int`,
					active: sql<number>`count(*) filter (where enabled = true)::int`,
				})
				.from(prompts)
				.where(eq(prompts.brandId, brand.id));

			const recentPromptCounts = await db
				.select({
					added7Days: sql<number>`count(*) filter (where ${prompts.createdAt} >= ${sevenDaysAgo})::int`,
					removed7Days: sql<number>`count(*) filter (where ${prompts.updatedAt} >= ${sevenDaysAgo} and ${prompts.enabled} = false)::int`,
					added30Days: sql<number>`count(*) filter (where ${prompts.createdAt} >= ${thirtyDaysAgo})::int`,
					removed30Days: sql<number>`count(*) filter (where ${prompts.updatedAt} >= ${thirtyDaysAgo} and ${prompts.enabled} = false)::int`,
				})
				.from(prompts)
				.where(eq(prompts.brandId, brand.id));

			const runStats = brandRunStatsMap.get(brand.id);
			const creator = brandCreators.get(brand.id);

			return {
				...brand,
				creatorName: creator?.name || null,
				creatorEmail: creator?.email || null,
				totalPrompts: promptCounts[0]?.total || 0,
				activePrompts: promptCounts[0]?.active || 0,
				promptRuns7Days: runStats?.runs_7d || 0,
				promptRuns30Days: runStats?.runs_30d || 0,
				lastPromptRunAt: runStats?.last_run_at ? new Date(runStats.last_run_at) : null,
				promptsAddedLast7Days: recentPromptCounts[0]?.added7Days || 0,
				promptsRemovedLast7Days: recentPromptCounts[0]?.removed7Days || 0,
				promptsAddedLast30Days: recentPromptCounts[0]?.added30Days || 0,
				promptsRemovedLast30Days: recentPromptCounts[0]?.removed30Days || 0,
				enabledModels: brand.enabledModels,
			};
		}),
	);

	const configs = parseScrapeTargets(process.env.SCRAPE_TARGETS);
	const availableModels = configs.map((c) => c.model);

	return {
		brands: brandStats,
		brandsOverTime,
		activeBrandsOverTime: activeBrandsData.map((row) => ({
			date: row.date,
			count: row.count,
		})),
		promptsOverTime: promptsData.map((row) => ({
			date: row.date,
			enabled: row.enabled,
			disabled: row.disabled,
		})),
		runsOverTime: runsOverTimeData.map((row) => ({
			date: row.date,
			count: row.count,
		})),
		availableModels,
	};
});

// ============================================================================
// Admin Dashboard - Delay Override
// ============================================================================

/**
 * Update delay override for a brand.
 */
export const updateDelayOverrideFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			delayOverrideHours: z.number().nullable(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		const result = await db
			.update(brands)
			.set({ delayOverrideHours: data.delayOverrideHours, updatedAt: new Date() })
			.where(eq(brands.id, data.brandId))
			.returning();
		if (!result[0]) throw new Error("Brand not found");
		return result[0];
	});

/**
 * Updates the enabled models for a brand.
 */
export const updateEnabledModelsFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			enabledModels: z.array(z.string()).nullable(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		await db
			.update(brands)
			.set({ enabledModels: data.enabledModels, updatedAt: new Date() })
			.where(eq(brands.id, data.brandId));

		return { success: true };
	});

/**
 * Delete a brand from the admin panel.
 *
 * Separate from `deleteBrandFn` because that one gates on org membership, and
 * an admin is generally not a member of the org being deleted. The brand name
 * is required and must match: the admin table lists every brand in one place,
 * so a misclick would otherwise wipe an unrelated customer's data.
 */
export const adminDeleteBrandFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), confirmName: z.string() }))
	.handler(async ({ data }) => {
		await requireAdmin();

		const brand = await db.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
		if (!brand) throw new Error("Brand not found");
		if (brand.name.trim() !== data.confirmName.trim()) throw new Error("Brand name does not match");

		await deleteBrandCascade(data.brandId);
		return { success: true };
	});

// ============================================================================
// Admin Tools - Analyze Brand
// ============================================================================

/**
 * Provider-agnostic brand analysis. Returns brand info, competitors, and
 * suggested prompts in a single LLM round-trip — same pipeline that the
 * onboarding wizard and `POST /api/v1/tools/analyze` use.
 */
export const adminAnalyzeBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			website: z.string().min(1),
			...onboardingLocaleSchemaFields,
			brandName: z.string().optional(),
			maxCompetitors: z.number().int().min(0).optional(),
			maxPrompts: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();
		return analyzeBrand({
			website: data.website,
			targetLanguage: data.targetLanguage,
			targetMarket: data.targetMarket,
			brandName: data.brandName,
			maxCompetitors: data.maxCompetitors,
			maxPrompts: data.maxPrompts,
		});
	});

// ============================================================================
// Admin Workflows - Data Fetching
// ============================================================================

function parseJobData(data: unknown): { promptId?: string } {
	if (!data) return {};
	try {
		const parsed = typeof data === "string" ? JSON.parse(data) : data;
		if (typeof parsed === "object" && parsed !== null) {
			return {
				promptId:
					typeof (parsed as Record<string, unknown>).promptId === "string"
						? ((parsed as Record<string, unknown>).promptId as string)
						: undefined,
			};
		}
	} catch {
		// ignore parse failures
	}
	return {};
}

async function getQueueStats() {
	return withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
		);

		if (!tableCheck.rows[0]?.exists) {
			return {
				name: "process-prompt",
				created: 0,
				active: 0,
				retry: 0,
				completed: 0,
				failed: 0,
				totalPending: 0,
			};
		}

		const result = await client.query(`
			SELECT
				COUNT(*) FILTER (WHERE state = 'created') AS created,
				COUNT(*) FILTER (WHERE state = 'active') AS active,
				COUNT(*) FILTER (WHERE state = 'retry') AS retry
			FROM pgboss.job
			WHERE name = 'process-prompt'
		`);

		const archiveCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'archive')`,
		);

		let completed = 0;
		let failed = 0;
		if (archiveCheck.rows[0]?.exists) {
			const archiveResult = await client.query(`
				SELECT
					COUNT(*) FILTER (WHERE state = 'completed') AS completed,
					COUNT(*) FILTER (WHERE state = 'failed') AS failed
				FROM pgboss.archive
				WHERE name = 'process-prompt'
			`);
			completed = Number(archiveResult.rows[0]?.completed || 0);
			failed = Number(archiveResult.rows[0]?.failed || 0);
		}

		const stats = {
			created: Number(result.rows[0]?.created || 0),
			active: Number(result.rows[0]?.active || 0),
			retry: Number(result.rows[0]?.retry || 0),
			completed,
			failed,
		};

		return {
			name: "process-prompt",
			...stats,
			totalPending: stats.created + stats.active + stats.retry,
		};
	});
}

async function getRecentJobs(limit = 50) {
	const jobs = await withPgClient(async (client) => {
		const [jobCheck, archiveCheck] = await Promise.all([
			client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
			),
			client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'archive')`,
			),
		]);

		const rows: any[] = [];

		if (jobCheck.rows[0]?.exists) {
			const result = await client.query(
				`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
				 FROM pgboss.job
				 WHERE name = 'process-prompt'
				   AND state IN ('completed', 'failed')
				 ORDER BY completed_on DESC NULLS LAST
				 LIMIT $1`,
				[limit],
			);
			rows.push(...result.rows);
		}

		if (archiveCheck.rows[0]?.exists) {
			const result = await client.query(
				`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
				 FROM pgboss.archive
				 WHERE name = 'process-prompt'
				 ORDER BY completed_on DESC NULLS LAST
				 LIMIT $1`,
				[limit],
			);
			rows.push(...result.rows);
		}

		return rows;
	});

	const deduped = new Map<string, (typeof jobs)[number]>();
	for (const row of jobs) {
		if (!deduped.has(row.id)) {
			deduped.set(row.id, row);
		}
	}

	const sorted = Array.from(deduped.values()).sort((a, b) => {
		const aTime = a.completed_on ? new Date(a.completed_on).getTime() : 0;
		const bTime = b.completed_on ? new Date(b.completed_on).getTime() : 0;
		return bTime - aTime;
	});

	return sorted.slice(0, limit).map((row) => {
		const data = parseJobData(row.data);
		let failedReason: string | null = null;

		if (row.state === "failed" && row.output) {
			try {
				const output = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
				failedReason = output?.message || output?.error || "Unknown error";
			} catch {
				failedReason = "Unknown error";
			}
		}

		return {
			id: row.id,
			name: row.name,
			data,
			status: row.state === "completed" ? ("completed" as const) : ("failed" as const),
			failedReason,
			attemptsMade: row.retry_count || 0,
			timestamp: row.created_on ? new Date(row.created_on).getTime() : 0,
			processedOn: row.started_on ? new Date(row.started_on).getTime() : null,
			finishedOn: row.completed_on ? new Date(row.completed_on).getTime() : null,
		};
	});
}

function getNextRunFromCron(cron: string, now: Date): number | null {
	const hourlyMatch = cron.match(/^0 \*\/(\d+) \* \* \*$/);
	if (hourlyMatch) {
		const interval = Number(hourlyMatch[1]);
		if (!Number.isFinite(interval) || interval <= 0) return null;

		const nowMs = now.getTime();
		const nowUtc = new Date(nowMs);
		const year = nowUtc.getUTCFullYear();
		const month = nowUtc.getUTCMonth();
		const day = nowUtc.getUTCDate();
		const hour = nowUtc.getUTCHours();
		const minute = nowUtc.getUTCMinutes();
		const second = nowUtc.getUTCSeconds();
		const ms = nowUtc.getUTCMilliseconds();

		let nextHour = hour;
		if (minute > 0 || second > 0 || ms > 0) {
			nextHour += 1;
		}

		for (let i = 0; i <= 48; i += 1) {
			const h = nextHour + i;
			if (h % interval === 0) {
				const dayOffset = Math.floor(h / 24);
				const hourOfDay = h % 24;
				const baseMidnight = Date.UTC(year, month, day, 0, 0, 0, 0);
				const candidateMs = baseMidnight + dayOffset * 24 * 60 * 60 * 1000 + hourOfDay * 60 * 60 * 1000;
				if (candidateMs > nowMs) {
					return candidateMs;
				}
			}
		}

		return null;
	}

	const dailyMatch = cron.match(/^0 0 (?:\*\/(\d+)|\*) \* \*$/);
	if (dailyMatch) {
		const dayInterval = dailyMatch[1] ? Number(dailyMatch[1]) : 1;
		if (!Number.isFinite(dayInterval) || dayInterval <= 0) return null;

		const nowMs = now.getTime();
		const nowUtc = new Date(nowMs);

		for (let i = 0; i <= 31; i += 1) {
			const candidate = new Date(
				Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + i, 0, 0, 0, 0),
			);
			const dayOfMonth = candidate.getUTCDate();
			const matches = dayInterval === 1 || (dayOfMonth - 1) % dayInterval === 0;
			if (matches && candidate.getTime() > nowMs) {
				return candidate.getTime();
			}
		}

		return null;
	}

	return null;
}

async function getScheduleMap() {
	const schedules = await withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'schedule')`,
		);

		if (!tableCheck.rows[0]?.exists) return [];

		const result = await client.query(`
			SELECT name, key, data, cron
			FROM pgboss.schedule
			WHERE name = 'process-prompt'
		`);
		return result.rows;
	});

	const map = new Map<string, { promptId: string; cadenceHours: number | null; nextRunAt: number | null }>();
	const now = new Date();

	for (const row of schedules) {
		const promptId = row.key;
		if (promptId) {
			let cadenceHours: number | null = null;
			let nextRunAt: number | null = null;
			if (row.cron) {
				const hourlyMatch = row.cron.match(/^0 \*\/(\d+) \* \* \*$/);
				if (hourlyMatch) {
					cadenceHours = Number(hourlyMatch[1]);
				} else {
					const dailyMatch = row.cron.match(/^0 0 (?:\*\/(\d+)|\*) \* \*$/);
					if (dailyMatch) {
						cadenceHours = dailyMatch[1] ? Number(dailyMatch[1]) * 24 : 24;
					}
				}
				nextRunAt = getNextRunFromCron(row.cron, now);
			}
			map.set(promptId, { promptId, cadenceHours, nextRunAt });
		}
	}

	return map;
}

async function getActiveJobMap() {
	const jobs = await withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
		);

		if (!tableCheck.rows[0]?.exists) return [];

		const result = await client.query(`
			SELECT id, data, state, created_on, started_on
			FROM pgboss.job
			WHERE name = 'process-prompt'
			  AND state IN ('created', 'active', 'retry')
			ORDER BY
				CASE state
					WHEN 'active' THEN 1
					WHEN 'retry' THEN 2
					WHEN 'created' THEN 3
					ELSE 4
				END,
				started_on DESC NULLS LAST,
				created_on DESC NULLS LAST
		`);
		return result.rows;
	});

	const map = new Map<string, { promptId: string; state: "created" | "active" | "retry" }>();

	for (const row of jobs) {
		const data = parseJobData(row.data);
		if (data.promptId) {
			if (!map.has(data.promptId)) {
				map.set(data.promptId, {
					promptId: data.promptId,
					state: row.state as "created" | "active" | "retry",
				});
			}
		}
	}

	return map;
}

/**
 * Get full workflow data: queue stats, recent jobs, brand schedule summaries.
 */
export const getWorkflowDataFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();

	const allBrands = await db.query.brands.findMany({ orderBy: desc(brands.createdAt) });
	const allPrompts = await db.query.prompts.findMany();

	const promptsByBrand: Record<string, typeof allPrompts> = {};
	for (const prompt of allPrompts) {
		if (!promptsByBrand[prompt.brandId]) {
			promptsByBrand[prompt.brandId] = [];
		}
		promptsByBrand[prompt.brandId].push(prompt);
	}

	const lastRunsQuery = await db
		.select({
			promptId: promptRuns.promptId,
			model: promptRuns.model,
			lastRunAt: sql<Date>`MAX(${promptRuns.createdAt})`.as("last_run_at"),
		})
		.from(promptRuns)
		.groupBy(promptRuns.promptId, promptRuns.model);

	const lastRunsMap: Record<string, Record<string, Date>> = {};
	for (const run of lastRunsQuery) {
		if (!lastRunsMap[run.promptId]) {
			lastRunsMap[run.promptId] = {};
		}
		lastRunsMap[run.promptId][run.model] = run.lastRunAt;
	}

	const [recentJobs, scheduleMap, activeJobMap, queueStats] = await Promise.all([
		getRecentJobs(5000),
		getScheduleMap(),
		getActiveJobMap(),
		getQueueStats(),
	]);

	const failuresByPrompt = new Map<string, number>();
	for (const job of recentJobs) {
		if (job.status === "failed" && job.data?.promptId) {
			failuresByPrompt.set(job.data.promptId, (failuresByPrompt.get(job.data.promptId) || 0) + 1);
		}
	}

	const now = Date.now();
	const defaultDelayHours = getDefaultDelayHours();
	const defaultSchedulerInfo = { exists: false, nextRunAt: null as number | null, cadenceHours: null as number | null };

	const brandSummaries = allBrands.map((brand) => {
		const brandPrompts = promptsByBrand[brand.id] || [];
		const delayHours = brand.delayOverrideHours ?? defaultDelayHours;
		const runFrequencyMs = delayHours * 60 * 60 * 1000;

		let overduePrompts = 0;
		let onSchedulePrompts = 0;
		let scheduledCount = 0;

		const modelList = parseScrapeTargets(process.env.SCRAPE_TARGETS).map((t) => t.model);
		const promptStatuses = brandPrompts.map((prompt) => {
			const lastRuns = lastRunsMap[prompt.id] || {};
			const lastRunsByModel: Record<
				string,
				{ lastRunAt: Date | null; isOverdue: boolean; overdueByMs: number | null }
			> = {};

			let anyOverdue = false;

			for (const model of modelList) {
				const lastRunAt = lastRuns[model] || null;
				let isOverdue = false;
				let overdueByMs: number | null = null;

				if (prompt.enabled) {
					if (lastRunAt) {
						const timeSinceRun = now - new Date(lastRunAt).getTime();
						if (timeSinceRun > runFrequencyMs) {
							isOverdue = true;
							overdueByMs = timeSinceRun - runFrequencyMs;
							anyOverdue = true;
						}
					} else {
						isOverdue = true;
						anyOverdue = true;
					}
				}

				lastRunsByModel[model] = { lastRunAt, isOverdue, overdueByMs };
			}

			const scheduleInfo = scheduleMap.get(prompt.id);
			const schedulerInfo = scheduleInfo
				? { exists: true, nextRunAt: scheduleInfo.nextRunAt, cadenceHours: scheduleInfo.cadenceHours }
				: defaultSchedulerInfo;

			const activeJob = activeJobMap.get(prompt.id);
			if (prompt.enabled && activeJob) scheduledCount++;

			if (prompt.enabled) {
				if (anyOverdue) {
					overduePrompts++;
				} else {
					onSchedulePrompts++;
				}
			}

			const jobStatus: "active" | "created" | "retry" | "none" = activeJob?.state ?? "none";

			return {
				promptId: prompt.id,
				promptValue: prompt.value,
				brandId: brand.id,
				brandName: brand.name,
				enabled: prompt.enabled,
				runFrequencyMs,
				lastRunsByModel,
				schedulerInfo,
				recentFailures: failuresByPrompt.get(prompt.id) || 0,
				jobStatus,
			};
		});

		const enabledPrompts = brandPrompts.filter((p) => p.enabled).length;

		return {
			brandId: brand.id,
			brandName: brand.name,
			website: brand.website,
			enabled: brand.enabled,
			totalPrompts: brandPrompts.length,
			enabledPrompts,
			runFrequencyMs,
			overduePrompts,
			onSchedulePrompts,
			schedulerCoverage: { scheduled: scheduledCount, total: enabledPrompts },
			prompts: promptStatuses,
		};
	});

	const totalOverdue = brandSummaries.reduce((sum, b) => sum + b.overduePrompts, 0);
	const totalOnSchedule = brandSummaries.reduce((sum, b) => sum + b.onSchedulePrompts, 0);
	const totalEnabled = brandSummaries.reduce((sum, b) => sum + b.enabledPrompts, 0);
	const totalPrompts = brandSummaries.reduce((sum, b) => sum + b.totalPrompts, 0);

	return {
		summary: {
			totalBrands: allBrands.length,
			totalPrompts,
			totalEnabled,
			totalOverdue,
			totalOnSchedule,
			percentOnSchedule: totalEnabled > 0 ? Math.round((totalOnSchedule / totalEnabled) * 100) : 100,
		},
		queue: queueStats,
		recentJobs: recentJobs.sort((a, b) => b.timestamp - a.timestamp),
		brands: brandSummaries,
	};
});

// ============================================================================
// Admin Workflows - Retry Job
// ============================================================================

/**
 * Retry a prompt job (send immediate job for a prompt).
 */
export const retryJobFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			promptId: z.string().optional(),
			jobId: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		const targetPromptId = data.promptId;
		if (!targetPromptId) {
			throw new Error("promptId is required");
		}

		const prompt = await db.query.prompts.findFirst({
			where: eq(prompts.id, targetPromptId),
		});

		if (!prompt) throw new Error("Prompt not found");
		if (!prompt.enabled) throw new Error("Prompt is disabled");

		const success = await sendImmediatePromptJob(targetPromptId);
		if (!success) throw new Error("Failed to send job");

		return { success: true, message: `Triggered immediate job for prompt ${targetPromptId}` };
	});

// ============================================================================
// Admin Workflows - Job Logs
// ============================================================================

/**
 * Get logs for a specific job.
 */
export const getJobLogsFn = createServerFn({ method: "GET" })
	.validator(z.object({ jobId: z.string() }))
	.handler(async ({ data }) => {
		await requireAdmin();

		const job = await withPgClient(async (client) => {
			const schemaCheck = await client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss')`,
			);

			if (!schemaCheck.rows[0]?.exists) return null;

			let result = await client.query(
				`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
				 FROM pgboss.job
				 WHERE id = $1`,
				[data.jobId],
			);

			if (result.rows.length === 0) {
				result = await client.query(
					`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
					 FROM pgboss.archive
					 WHERE id = $1`,
					[data.jobId],
				);
			}

			return result.rows[0] || null;
		});

		if (!job) throw new Error("Job not found");

		const logs: string[] = [];
		logs.push(`Job ID: ${job.id}`);
		logs.push(`Name: ${job.name}`);
		logs.push(`State: ${job.state}`);
		logs.push(`Retry count: ${job.retry_count || 0}`);

		if (job.created_on) logs.push(`Created: ${new Date(job.created_on).toISOString()}`);
		if (job.started_on) logs.push(`Started: ${new Date(job.started_on).toISOString()}`);
		if (job.completed_on) logs.push(`Completed: ${new Date(job.completed_on).toISOString()}`);

		if (job.data) {
			try {
				const d = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
				logs.push(`Data: ${JSON.stringify(d, null, 2)}`);
			} catch {
				logs.push(`Data: ${String(job.data)}`);
			}
		}

		if (job.output) {
			try {
				const output = typeof job.output === "string" ? JSON.parse(job.output) : job.output;
				logs.push(
					job.state === "failed"
						? `Error: ${JSON.stringify(output, null, 2)}`
						: `Output: ${JSON.stringify(output, null, 2)}`,
				);
			} catch {
				logs.push(`Output: ${String(job.output)}`);
			}
		}

		return { jobId: data.jobId, logs, count: logs.length };
	});

// ============================================================================
// Provider API usage
// ============================================================================

/**
 * Billable upstream calls, grouped for reconciliation against a vendor invoice.
 *
 * One `provider_calls` row is one billable unit (one scrape / one completion),
 * so these are raw counts, not estimates. Failed calls are counted separately
 * but included in the total: an upstream that errors mid-work still bills.
 */
export const getProviderUsageFn = createServerFn({ method: "GET" })
	.validator(z.object({ days: z.number().int().min(1).max(365).default(30) }))
	.handler(async ({ data }) => {
		await requireAdmin();

		const since = new Date();
		since.setDate(since.getDate() - data.days);

		const [byModel, byProvider, overTime, recentFailures] = await Promise.all([
			db
				.select({
					provider: providerCalls.provider,
					model: providerCalls.model,
					total: sql<number>`COUNT(*)::int`,
					failed: sql<number>`COUNT(*) FILTER (WHERE ${providerCalls.success} = false)::int`,
					// Timing is measured over successful calls only — a provider that fails
					// fast would otherwise flatter its own average.
					avgMs: sql<number | null>`AVG(${providerCalls.durationMs}) FILTER (WHERE ${providerCalls.success})::int`,
					p95Ms: sql<
						number | null
					>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${providerCalls.durationMs}) FILTER (WHERE ${providerCalls.success})::int`,
					maxMs: sql<number | null>`MAX(${providerCalls.durationMs}) FILTER (WHERE ${providerCalls.success})::int`,
					lastCallAt: sql<string | null>`MAX(${providerCalls.createdAt})`,
				})
				.from(providerCalls)
				.where(sql`${providerCalls.createdAt} >= ${since}`)
				.groupBy(providerCalls.provider, providerCalls.model)
				.orderBy(sql`COUNT(*) DESC`),

			db
				.select({
					provider: providerCalls.provider,
					total: sql<number>`COUNT(*)::int`,
					failed: sql<number>`COUNT(*) FILTER (WHERE ${providerCalls.success} = false)::int`,
				})
				.from(providerCalls)
				.where(sql`${providerCalls.createdAt} >= ${since}`)
				.groupBy(providerCalls.provider)
				.orderBy(sql`COUNT(*) DESC`),

			// Zero-filled daily series so a gap reads as "no calls" rather than a
			// missing point the chart would interpolate across.
			db
				.select({
					date: sql<string>`date_series::date`,
					provider: sql<string>`COALESCE(${providerCalls.provider}, 'none')`,
					total: sql<number>`COUNT(${providerCalls.id})::int`,
				})
				.from(
					sql`generate_series(
						NOW()::date - (${data.days} || ' days')::interval,
						NOW()::date,
						INTERVAL '1 day'
					) AS date_series`,
				)
				.leftJoin(providerCalls, sql`${providerCalls.createdAt}::date = date_series::date`)
				.groupBy(sql`date_series`, providerCalls.provider)
				.orderBy(sql`date_series`),

			db
				.select({
					id: providerCalls.id,
					provider: providerCalls.provider,
					model: providerCalls.model,
					kind: providerCalls.kind,
					errorMessage: providerCalls.errorMessage,
					createdAt: providerCalls.createdAt,
				})
				.from(providerCalls)
				.where(sql`${providerCalls.success} = false AND ${providerCalls.createdAt} >= ${since}`)
				.orderBy(desc(providerCalls.createdAt))
				.limit(20),
		]);

		return {
			days: data.days,
			since: since.toISOString(),
			byModel,
			byProvider,
			overTime,
			recentFailures,
			grandTotal: byProvider.reduce((sum, p) => sum + p.total, 0),
		};
	});

// ============================================================================
// Admin Queue - run order
// ============================================================================

export interface QueueJobRow {
	jobId: string;
	promptId: string | null;
	promptValue: string;
	brandId: string | null;
	brandName: string;
	state: "created" | "active" | "retry";
	priority: number;
	/** Position in the order pg-boss will actually hand these out. Null while active or waiting on its start time. */
	position: number | null;
	createdOn: string | null;
	startedOn: string | null;
	startAfter: string | null;
}

export interface BrandQueueRow {
	brandId: string;
	brandName: string;
	enabled: boolean;
	enabledPrompts: number;
	running: number;
	readyNow: number;
	scheduledLater: number;
	/** Highest priority across the brand's waiting jobs - anything above 0 has been pushed to the front. */
	maxPriority: number;
	/** Where the brand's first waiting job sits in the global run order. */
	bestPosition: number | null;
	oldestReadyWaitMs: number | null;
	lastRunAt: string | null;
	neverRun: boolean;
}

/**
 * Every in-flight or waiting `process-prompt` job.
 *
 * Read straight from `pgboss.job` rather than through pg-boss's API because the
 * two columns this page exists to show - `priority` and `start_after` - are not
 * exposed by any client method.
 */
async function getQueueJobRows() {
	return withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
		);
		if (!tableCheck.rows[0]?.exists) return [];

		const result = await client.query(`
			SELECT id, data, state, priority, created_on, started_on, start_after,
			       start_after <= now() AS is_ready
			FROM pgboss.job
			WHERE name = 'process-prompt'
			  AND state IN ('created', 'active', 'retry')
		`);
		return result.rows;
	});
}

/**
 * What the worker is running now, what it will pick up next, and how each brand
 * sits in that order.
 *
 * The "next up" order is pg-boss's own fetch order reproduced here
 * (`ORDER BY priority DESC, created_on, id` over jobs whose start time has
 * passed). It is duplicated rather than queried because a brand's position only
 * means anything relative to every other brand's, so the sort has to happen
 * over the whole waiting set at once.
 */
export const getQueueOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();

	const [jobRows, allBrands, allPrompts, lastRuns] = await Promise.all([
		getQueueJobRows(),
		db.query.brands.findMany(),
		db.query.prompts.findMany(),
		db
			.select({
				brandId: prompts.brandId,
				lastRunAt: sql<string | null>`MAX(${promptRuns.createdAt})`,
			})
			.from(promptRuns)
			.innerJoin(prompts, eq(prompts.id, promptRuns.promptId))
			.groupBy(prompts.brandId),
	]);

	const brandById = new Map(allBrands.map((b) => [b.id, b]));
	const promptById = new Map(allPrompts.map((p) => [p.id, p]));
	const lastRunByBrand = new Map(lastRuns.map((r) => [r.brandId, r.lastRunAt]));

	const now = Date.now();
	const toRow = (row: Record<string, unknown>): QueueJobRow & { isReady: boolean } => {
		const promptId = parseJobData(row.data).promptId ?? null;
		const prompt = promptId ? promptById.get(promptId) : undefined;
		const brand = prompt ? brandById.get(prompt.brandId) : undefined;
		const toIso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
		return {
			jobId: String(row.id),
			promptId,
			promptValue: prompt?.value ?? "(deleted prompt)",
			brandId: brand?.id ?? null,
			brandName: brand?.name ?? "(unknown brand)",
			state: row.state as "created" | "active" | "retry",
			priority: Number(row.priority ?? 0),
			position: null,
			createdOn: toIso(row.created_on),
			startedOn: toIso(row.started_on),
			startAfter: toIso(row.start_after),
			isReady: Boolean(row.is_ready),
		};
	};

	const all = (jobRows as Record<string, unknown>[]).map(toRow);
	const running = all
		.filter((j) => j.state === "active")
		.sort((a, b) => (a.startedOn ?? "").localeCompare(b.startedOn ?? ""));

	const ready = all.filter((j) => j.state !== "active" && j.isReady).sort(compareQueueOrder);
	ready.forEach((job, index) => {
		job.position = index + 1;
	});

	const later = all.filter((j) => j.state !== "active" && !j.isReady);

	const brandRows = new Map<string, BrandQueueRow>();
	const rowFor = (brandId: string): BrandQueueRow => {
		const existing = brandRows.get(brandId);
		if (existing) return existing;
		const brand = brandById.get(brandId);
		const lastRunAt = lastRunByBrand.get(brandId) ?? null;
		const row: BrandQueueRow = {
			brandId,
			brandName: brand?.name ?? "(unknown brand)",
			enabled: brand?.enabled ?? false,
			enabledPrompts: allPrompts.filter((p) => p.brandId === brandId && p.enabled).length,
			running: 0,
			readyNow: 0,
			scheduledLater: 0,
			maxPriority: 0,
			bestPosition: null,
			oldestReadyWaitMs: null,
			lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
			neverRun: !lastRunAt,
		};
		brandRows.set(brandId, row);
		return row;
	};

	// Every brand with prompts gets a row, so a brand with nothing queued is
	// visible as exactly that rather than silently absent.
	for (const brand of allBrands) {
		if (allPrompts.some((p) => p.brandId === brand.id)) rowFor(brand.id);
	}

	for (const job of running) {
		if (job.brandId) rowFor(job.brandId).running++;
	}
	for (const job of ready) {
		if (!job.brandId) continue;
		const row = rowFor(job.brandId);
		row.readyNow++;
		row.maxPriority = Math.max(row.maxPriority, job.priority);
		if (row.bestPosition === null || (job.position ?? Infinity) < row.bestPosition) {
			row.bestPosition = job.position;
		}
		const waitMs = job.createdOn ? now - new Date(job.createdOn).getTime() : null;
		if (waitMs !== null && (row.oldestReadyWaitMs === null || waitMs > row.oldestReadyWaitMs)) {
			row.oldestReadyWaitMs = waitMs;
		}
	}
	for (const job of later) {
		if (job.brandId) rowFor(job.brandId).scheduledLater++;
	}

	const strip = ({ isReady: _isReady, ...job }: QueueJobRow & { isReady: boolean }): QueueJobRow => job;

	return {
		generatedAt: new Date().toISOString(),
		priorityValue: FIRST_RUN_JOB_PRIORITY,
		summary: {
			running: running.length,
			readyNow: ready.length,
			scheduledLater: later.length,
			prioritised: ready.filter((j) => j.priority > 0).length,
			brandsWaiting: [...brandRows.values()].filter((b) => b.readyNow > 0).length,
		},
		running: running.map(strip),
		upNext: ready.slice(0, 50).map(strip),
		brands: [...brandRows.values()],
	};
});

/**
 * Move a brand's waiting prompts to the front of the queue, or put them back.
 *
 * pg-boss hands out jobs by `priority DESC, created_on`, so raising the priority
 * on the rows that are already waiting is enough - no job is cancelled and
 * re-created, and an `active` job is left alone because it is already running.
 * Enabled prompts with nothing waiting get a fresh job so that "run this brand
 * first" works on a brand whose next run is still hours out.
 *
 * The bump is spent when the job completes: the worker enqueues the next cycle
 * at the default priority, so this does not permanently promote a brand.
 */
export const setBrandQueuePriorityFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), priority: z.enum(["high", "normal"]) }))
	.handler(async ({ data }) => {
		await requireAdmin();

		const brand = await db.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
		if (!brand) throw new Error("Brand not found");

		const brandPrompts = await db.query.prompts.findMany({
			where: and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true)),
		});
		if (brandPrompts.length === 0) throw new Error("Brand has no enabled prompts");

		const promptIds = brandPrompts.map((p) => p.id);
		const high = data.priority === "high";

		const { promoted, alreadyQueued } = await withPgClient(async (client) => {
			const tableCheck = await client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
			);
			if (!tableCheck.rows[0]?.exists) return { promoted: 0, alreadyQueued: new Set<string>() };

			// Waiting jobs get the new priority. Demoting back to normal leaves
			// `start_after` alone: an expedited job cannot be un-expedited, and it
			// takes its normal turn once the priority is gone anyway.
			const updated = await client.query(
				high
					? `UPDATE pgboss.job SET priority = $2, start_after = now()
					   WHERE name = 'process-prompt' AND state IN ('created', 'retry') AND data->>'promptId' = ANY($1::text[])
					   RETURNING data->>'promptId' AS prompt_id`
					: `UPDATE pgboss.job SET priority = $2
					   WHERE name = 'process-prompt' AND state IN ('created', 'retry') AND data->>'promptId' = ANY($1::text[])
					   RETURNING data->>'promptId' AS prompt_id`,
				[promptIds, high ? FIRST_RUN_JOB_PRIORITY : 0],
			);

			// An active job is already running; a prompt that has one needs no new job.
			const active = await client.query(
				`SELECT data->>'promptId' AS prompt_id FROM pgboss.job
				 WHERE name = 'process-prompt' AND state = 'active' AND data->>'promptId' = ANY($1::text[])`,
				[promptIds],
			);

			const covered = new Set<string>();
			for (const row of [...updated.rows, ...active.rows]) {
				if (row.prompt_id) covered.add(String(row.prompt_id));
			}
			return { promoted: updated.rowCount ?? 0, alreadyQueued: covered };
		});

		let queued = 0;
		if (high) {
			const missing = promptIds.filter((id) => !alreadyQueued.has(id));
			const results = await Promise.all(missing.map((id) => sendImmediatePromptJob(id)));
			queued = results.filter(Boolean).length;
		}

		return {
			success: true,
			promoted,
			queued,
			message: high
				? `${brand.name}: ${promoted} queued job(s) moved to the front${queued > 0 ? `, ${queued} new job(s) added` : ""}`
				: `${brand.name}: ${promoted} queued job(s) back to normal priority`,
		};
	});
