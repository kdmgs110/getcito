/**
 * User / org / membership provisioning.
 *
 * Single place where "create a new user with an org and admin membership"
 * happens for local mode. Demo deployments reuse a database populated by
 * running the stack in local mode first, so there is no separate demo
 * provisioning path — the public demo box is just a read-only view over
 * that already-bootstrapped data.
 *
 * Initial signup is one-shot: better-auth rejects signup once a user exists.
 * Additional brands are separately provisioned with request identities so
 * network retries cannot produce duplicate organizations or partial brands.
 */
import { createHash } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { brands, member, organization, user } from "./schema";

/**
 * Number of users in the database.
 *
 * Used by the local-mode signup guard — "allow the first signup, reject
 * every subsequent one". Kept as its own small function so the hook
 * doesn't import drizzle directly.
 */
export async function countUsers(): Promise<number> {
	const [row] = await db.select({ count: count() }).from(user);
	return row?.count ?? 0;
}

/**
 * The single organization created in local mode.
 *
 * Keep the initial organization stable so existing `/app/default` URLs
 * continue working. Additional brands receive independent organizations.
 */
const LOCAL_ORG = {
	id: "default",
	name: "Default",
	slug: "default",
} as const;

/**
 * Create the organization + admin membership for a freshly-created
 * local-mode user. Called from the better-auth `user.create.after`
 * database hook so the user always lands in exactly one org with admin
 * rights.
 */
export async function provisionLocalOrg(input: { userId: string }): Promise<{ orgId: string }> {
	await db.insert(organization).values({
		id: LOCAL_ORG.id,
		name: LOCAL_ORG.name,
		slug: LOCAL_ORG.slug,
		createdAt: new Date(),
	});

	await db.insert(member).values({
		id: crypto.randomUUID(),
		organizationId: LOCAL_ORG.id,
		userId: input.userId,
		role: "admin",
		createdAt: new Date(),
	});

	return { orgId: LOCAL_ORG.id };
}

/**
 * Slugify a brand name into the URL/id form used for new local-mode orgs.
 * Exported so the slug rules can be unit-tested directly without a database.
 *
 * Note: leading/trailing hyphens are trimmed via index walks instead of an
 * `^-+|-+$` alternation regex — the alternation form trips ReDoS scanners
 * on inputs like `"---"` even though the JS engine handles it linearly.
 */
export function slugifyOrgName(name: string): string {
	const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	let start = 0;
	while (start < cleaned.length && cleaned[start] === "-") start++;
	let end = cleaned.length;
	while (end > start && cleaned[end - 1] === "-") end--;
	const slug = cleaned.slice(start, end);
	return slug || "brand";
}

export class BrandCreationConflictError extends Error {
	constructor() {
		super("BRAND_CREATION_REQUEST_CONFLICT");
	}
}

/** User-scoped request identities make retries idempotent without changing existing brand URLs. */
export function localBrandId(userId: string, requestId: string): string {
	return `brand-${createHash("sha256")
		.update(JSON.stringify([userId, requestId]))
		.digest("hex")}`;
}

/** Create all three rows atomically. The transaction lock also serializes concurrent retries. */
export async function provisionAdditionalLocalBrand(input: {
	userId: string;
	name: string;
	website: string;
	targetMarket?: string | null;
	targetLanguage?: string | null;
	additionalDomains?: string[];
	requestId: string;
}): Promise<{ orgId: string }> {
	const orgId = localBrandId(input.userId, input.requestId);

	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`);
		const existing = await tx.query.brands.findFirst({ where: eq(brands.id, orgId) });
		if (existing) {
			const membership = await tx.query.member.findFirst({
				where: and(eq(member.organizationId, orgId), eq(member.userId, input.userId)),
			});
			if (
				!membership ||
				existing.name !== input.name ||
				existing.website !== input.website ||
				existing.targetMarket !== (input.targetMarket || null) ||
				existing.targetLanguage !== (input.targetLanguage || null)
			)
				throw new BrandCreationConflictError();
			return;
		}

		await tx.insert(organization).values({
			id: orgId,
			name: input.name,
			slug: orgId,
			createdAt: new Date(),
		});

		await tx.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: orgId,
			userId: input.userId,
			role: "admin",
			createdAt: new Date(),
		});

		await tx.insert(brands).values({
			id: orgId,
			name: input.name,
			website: input.website,
			targetMarket: input.targetMarket || null,
			targetLanguage: input.targetLanguage || null,
			enabled: true,
			...(input.additionalDomains?.length ? { additionalDomains: input.additionalDomains } : {}),
		});
	});

	return { orgId };
}
