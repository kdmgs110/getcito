/**
 * Server functions for brand operations.
 * Replaces apps/web/src/app/api/brands/* API routes.
 */
import { createServerFn } from "@tanstack/react-start";
import { normalizeBrandLocale } from "@workspace/lib/brand-locale";
import {
	registerMentionBrand,
	saveMentionCompetitors,
	startMentionRecount,
	withMentionTransaction,
} from "@workspace/lib/brand-mention-recount";
import { db } from "@workspace/lib/db/db";
import { BrandCreationConflictError, provisionAdditionalLocalBrand } from "@workspace/lib/db/provisioning";
import { type Brand, type BrandWithPrompts, brands, competitors, prompts } from "@workspace/lib/db/schema";
import { measurementTargetKey } from "@workspace/lib/measurement";
import type { ModelConfig } from "@workspace/lib/providers";
import { parseScrapeTargets, selectTargetsForBrand } from "@workspace/lib/providers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import {
	listUserOrganizations,
	requireAuthSession,
	requireOrgAccess,
	requireOrgManageAccess,
} from "@/lib/auth/helpers";
import { evaluateRequireCanCreateBrands } from "@/lib/auth/policies";
import { type BrandCreationResult, normalizeBrandCreation } from "@/lib/brand-creation";
import { normalizeBrandUpdate } from "@/lib/brand-settings";
import { validateWebsiteUrl } from "@/lib/brand-website";
import { getDeployment } from "@/lib/config/server";
import { cleanAndValidateDomain } from "@/lib/domain-categories";
import { enqueueMentionRecount } from "@/lib/mention-recount-client";
import { deleteBrandCascade } from "@/server/brand-cascade";
import { saveBrandMeasurementTargets } from "@/server/brand-measurement-settings";

/**
 * Deployment-configured models this brand actually runs, after applying
 * the brand's `enabledModels` override. The filter bar + LLMs info page +
 * any other UI that shows "which models is this brand tracking?" should
 * read from here instead of hardcoding a list — different deployments can
 * configure any arbitrary set of models via `SCRAPE_TARGETS`.
 *
 * `effectiveModels` is the flat id list that most callers want; the full
 * `ModelConfig[]` (with provider, version, webSearch) is kept on the same
 * object for pages that render per-model metadata (e.g. settings/llms).
 */
function computeEffectiveModels(brand: Brand): {
	effectiveModels: string[];
	effectiveModelConfigs: ModelConfig[];
	availableModelConfigs: ModelConfig[];
} {
	let configs: ModelConfig[] = [];
	try {
		configs = parseScrapeTargets(process.env.SCRAPE_TARGETS);
		const effective = selectTargetsForBrand(configs, brand.enabledModels, brand.enabledTargets);
		return {
			effectiveModels: [...new Set(effective.map((c) => c.model))],
			effectiveModelConfigs: effective,
			availableModelConfigs: configs,
		};
	} catch {
		// A misconfigured SCRAPE_TARGETS would already be surfacing via
		// `validateScrapeTargets` at boot; here we'd rather degrade to empty
		// lists than crash the brand fetch.
		return { effectiveModels: [], effectiveModelConfigs: [], availableModelConfigs: configs };
	}
}

function getDefaultBrandDomains(): string[] {
	const raw = process.env.DEFAULT_BRAND_DOMAINS;
	if (!raw) return [];
	return raw
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean)
		.map((d) => cleanAndValidateDomain(d))
		.filter((d): d is string => d !== null);
}

// ============================================================================
// Helper functions (migrated from apps/web/src/lib/metadata.ts)
// ============================================================================

async function getBrandWithPromptsFromDb(brandId: string): Promise<
	| (BrandWithPrompts & {
			effectiveModels: string[];
			effectiveModelConfigs: ModelConfig[];
			availableModelConfigs: ModelConfig[];
	  })
	| undefined
> {
	try {
		const brand = await db.query.brands.findFirst({
			where: eq(brands.id, brandId),
		});
		if (!brand) return undefined;

		const brandPrompts = await db.query.prompts.findMany({
			where: eq(prompts.brandId, brandId),
		});
		const brandCompetitors = await db.query.competitors.findMany({
			where: eq(competitors.brandId, brandId),
		});

		return {
			...brand,
			prompts: brandPrompts,
			competitors: brandCompetitors,
			...computeEffectiveModels(brand),
		};
	} catch (error) {
		console.error("Error fetching brand with prompts:", error);
		return undefined;
	}
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Get all brands the current user has access to
 */
export const getBrands = createServerFn({ method: "GET" }).handler(async () => {
	const session = await requireAuthSession();
	const userBrands = await listUserOrganizations(session.user.id);

	if (!userBrands || userBrands.length === 0) {
		return [];
	}

	const brandsData = await Promise.all(
		userBrands.map(async (userBrand) => {
			const dbBrand = await getBrandWithPromptsFromDb(userBrand.id);
			return dbBrand ? { ...dbBrand, name: dbBrand.name } : null;
		}),
	);

	return brandsData.filter(
		(
			brand,
		): brand is BrandWithPrompts & {
			effectiveModels: string[];
			effectiveModelConfigs: ModelConfig[];
			availableModelConfigs: ModelConfig[];
		} => brand !== null,
	);
});

/**
 * Get a single brand by ID
 */
export const getBrand = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const brand = await getBrandWithPromptsFromDb(data.brandId);
		if (!brand) {
			throw new Error("Brand not found");
		}

		return brand;
	});

/**
 * Create a new brand
 */
export const createBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			brandName: z.string(),
			website: z.string(),
			targetMarket: z.string().nullable().optional(),
			targetLanguage: z.string().nullable().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const urlValidation = validateWebsiteUrl(data.website);
		if (!urlValidation.isValid) {
			throw new Error(urlValidation.error);
		}

		const defaultDomains = getDefaultBrandDomains();

		const result = await db
			.insert(brands)
			.values({
				id: data.brandId,
				name: data.brandName,
				website: urlValidation.formattedUrl,
				...normalizeBrandLocale(data),
				enabled: true,
				...(defaultDomains.length > 0 && { additionalDomains: defaultDomains }),
			})
			.onConflictDoNothing()
			.returning();

		const brand =
			result[0] ??
			(await db.query.brands.findFirst({
				where: eq(brands.id, data.brandId),
			}));

		if (!brand) {
			throw new Error("Failed to create brand");
		}

		return { success: true, brand };
	});

/**
 * Create a new organization + admin membership + brand in one shot for the
 * current user. Used by the local-mode multi-brand "create new brand" flow on
 * the brand switcher. Gated by the canCreateBrands deployment feature so
 * whitelabel (orgs come from Auth0) and demo (read-only) reject it.
 */
export const createBrandWithOrgFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandName: z.string(),
			website: z.string(),
			targetMarket: z.string().nullable().optional(),
			targetLanguage: z.string().nullable().optional(),
			requestId: z.string().optional(),
		}),
	)
	.handler(async ({ data }): Promise<BrandCreationResult> => {
		const session = await requireAuthSession().catch(() => null);
		if (!session) return { ok: false, error: { code: "AUTH_REQUIRED" } };
		const deployment = getDeployment();

		if (evaluateRequireCanCreateBrands(deployment.features.canCreateBrands) === "deny") {
			return { ok: false, error: { code: "FORBIDDEN" } };
		}

		const normalized = normalizeBrandCreation(data);
		if (!normalized.ok) return normalized;
		try {
			const { orgId } = await provisionAdditionalLocalBrand({
				...normalized.value,
				userId: session.user.id,
				requestId: data.requestId || crypto.randomUUID(),
				additionalDomains: getDefaultBrandDomains(),
			});
			return { ok: true, brandId: orgId };
		} catch (error) {
			if (error instanceof BrandCreationConflictError) return { ok: false, error: { code: "REQUEST_CONFLICT" } };
			console.error("[brands] Brand creation transaction failed", error);
			return { ok: false, error: { code: "SAVE_FAILED" } };
		}
	});

/**
 * Update a brand
 */
export const updateBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			name: z.string().optional(),
			website: z.string().optional(),
			targetMarket: z.string().nullable().optional(),
			targetLanguage: z.string().nullable().optional(),
			shortDescription: z.string().optional(),
			additionalDomains: z.array(z.string()).optional(),
			aliases: z.array(z.string()).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");

		const normalized = normalizeBrandUpdate({
			targetLanguage: data.targetLanguage,
			targetMarket: data.targetMarket,
			name: data.name,
			website: data.website,
			additionalDomains: data.additionalDomains,
			aliases: data.aliases,
		});
		if (!normalized.ok) {
			throw new Error(normalized.error);
		}
		const updateData = {
			...normalized.updates,
			...(data.shortDescription !== undefined && { shortDescription: data.shortDescription }),
		};

		const affectsMentions =
			data.name !== undefined ||
			data.website !== undefined ||
			data.aliases !== undefined ||
			data.additionalDomains !== undefined;
		const save = (connection: Pick<typeof db, "update">) =>
			connection
				.update(brands)
				.set({ ...updateData, updatedAt: new Date() })
				.where(eq(brands.id, data.brandId))
				.returning();
		const result = affectsMentions
			? await withMentionTransaction(data.brandId, async (client) => {
					const rows = await save(drizzle(client));
					await startMentionRecount(client, data.brandId, enqueueMentionRecount);
					return rows;
				})
			: await save(db);

		if (!result[0]) {
			throw new Error("Failed to update brand");
		}

		return result[0];
	});

/** Newly enabled targets run immediately; historical results remain unchanged. */
export const updateBrandMeasurementTargetsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), targetKeys: z.array(z.string().min(1).max(300)).max(100) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");
		const configured = parseScrapeTargets(process.env.SCRAPE_TARGETS);
		const selected = selectTargetsForBrand(configured, null, data.targetKeys);
		const targetKeys = [...new Set(selected.map(measurementTargetKey))];
		return saveBrandMeasurementTargets({ brandId: data.brandId, targetKeys }, configured);
	});

/**
 * Get competitors for a brand
 */
export const getCompetitors = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		return db.query.competitors.findMany({
			where: eq(competitors.brandId, data.brandId),
		});
	});

/**
 * Update competitors for a brand (bulk replace)
 */
export const updateCompetitors = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			competitors: z.array(
				z.object({
					id: z.string().uuid().optional(),
					name: z.string().trim().min(1).max(200),
					domains: z.array(z.string()),
					aliases: z.array(z.string()).optional().default([]),
				}),
			),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");

		await saveMentionCompetitors(data.brandId, data.competitors, enqueueMentionRecount);
		return db.query.competitors.findMany({ where: eq(competitors.brandId, data.brandId) });
	});

/**
 * Add an additional domain to the brand itself
 */
export const addDomainToBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			domain: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");

		const brand = await db.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
		if (!brand) throw new Error("Brand not found");
		await registerMentionBrand(
			{ brandId: data.brandId, name: brand.name, domain: data.domain, target: "own" },
			enqueueMentionRecount,
		);
		return db.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
	});

/**
 * Add a domain to an existing competitor
 */
export const addDomainToCompetitorFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			competitorId: z.string(),
			domain: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");

		const existing = await db.query.competitors.findFirst({
			where: and(eq(competitors.id, data.competitorId), eq(competitors.brandId, data.brandId)),
		});
		if (!existing) throw new Error("Competitor not found");
		await registerMentionBrand(
			{
				brandId: data.brandId,
				name: existing.name,
				domain: data.domain,
				target: "competitor",
				competitorId: existing.id,
			},
			enqueueMentionRecount,
		);
		return db.query.competitors.findFirst({ where: eq(competitors.id, existing.id) });
	});

/**
 * Create a new competitor from a domain
 */
export const createCompetitorFromDomainFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			name: z.string().min(1),
			domain: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");

		const result = await registerMentionBrand(
			{ brandId: data.brandId, name: data.name, domain: data.domain, target: "new" },
			enqueueMentionRecount,
		);
		return db.query.competitors.findFirst({ where: eq(competitors.id, result.entityId) });
	});

/**
 * Delete a brand and all associated data
 */
export const deleteBrandFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		await deleteBrandCascade(data.brandId);

		return { success: true };
	});
