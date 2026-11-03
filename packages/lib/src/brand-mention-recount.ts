/** Server-only: reassess stored answers without calling an acquisition provider. */
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { analyzeBrandMentions, type MentionCatalog, mentionFlags } from "./brand-mentions";
import { MAX_COMPETITORS } from "./constants";
import { db } from "./db/db";
import { extractTextContent } from "./text-extraction";

export const MENTION_RECOUNT_QUEUE = "recount-brand-mentions";
export const MENTION_RECOUNT_POLICY = { retryLimit: 2, retryDelay: 15, retryBackoff: true, expireInSeconds: 3600 };

export interface MentionRecountStatus {
	status: "idle" | "pending" | "running" | "completed" | "failed";
	id?: string;
	processed: number;
	total: number;
	error?: string;
	completedAt?: string;
}

export interface RegisterMentionBrandInput {
	brandId: string;
	name: string;
	domain?: string;
	aliases?: string[];
	target: "new" | "own" | "competitor";
	competitorId?: string;
	sourceRunId?: string;
}

export type EnqueueMentionRecount = (data: { brandId: string; id: string }, client: PoolClient) => Promise<void>;
type RecountRow = {
	id: string;
	status: Exclude<MentionRecountStatus["status"], "idle">;
	processed: number;
	total: number;
	catalog_hash: string;
	completed_at: Date | string | null;
};

/** Also used by the acquisition transaction; all writers use the same lock key. */
export function mentionLockKey(brandId: string): string {
	return `brand-mentions:${brandId}`;
}

export async function withMentionTransaction<T>(
	brandId: string,
	action: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await db.$client.connect();
	try {
		await client.query("BEGIN");
		await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [mentionLockKey(brandId)]);
		const result = await action(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export async function loadMentionCatalog(brandId: string, client?: PoolClient): Promise<MentionCatalog> {
	const connection = client ?? db.$client;
	const own = await connection.query<{
		id: string;
		name: string;
		aliases: string[];
		website: string;
		additional_domains: string[];
	}>("SELECT id, name, aliases, website, additional_domains FROM brands WHERE id=$1", [brandId]);
	if (!own.rows[0]) throw new Error("Brand not found");
	const competitors = await connection.query<{ id: string; name: string; aliases: string[]; domains: string[] }>(
		"SELECT id, name, aliases, domains FROM competitors WHERE brand_id=$1 ORDER BY id",
		[brandId],
	);
	const brand = own.rows[0];
	return {
		own: {
			id: brand.id,
			name: brand.name,
			aliases: brand.aliases,
			domains: [brand.website, ...brand.additional_domains],
		},
		competitors: competitors.rows,
	};
}

export function mentionCatalogHash(catalog: MentionCatalog): string {
	const canonical = (entity: MentionCatalog["own"]) => ({
		id: entity.id,
		name: entity.name,
		aliases: [...(entity.aliases ?? [])].sort(),
		domains: [...(entity.domains ?? [])].sort(),
	});
	return createHash("sha256")
		.update(
			JSON.stringify({
				version: 1,
				own: canonical(catalog.own),
				competitors: catalog.competitors.map(canonical).sort((a, b) => a.id.localeCompare(b.id)),
			}),
		)
		.digest("hex");
}

function publicStatus(row?: RecountRow): MentionRecountStatus {
	if (!row) return { status: "idle", processed: 0, total: 0 };
	return {
		id: row.id,
		status: row.status,
		processed: Number(row.processed),
		total: Number(row.total),
		...(row.status === "failed" ? { error: "過去回答の再集計に失敗しました。再試行してください。" } : {}),
		...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
	};
}

export async function getMentionRecountStatus(brandId: string): Promise<MentionRecountStatus> {
	const result = await db.$client.query<RecountRow>("SELECT * FROM brand_mention_recounts WHERE brand_id=$1", [
		brandId,
	]);
	return publicStatus(result.rows[0]);
}

/** Called in the definition-change transaction, including the pg-boss insert. */
export async function startMentionRecount(
	client: PoolClient,
	brandId: string,
	enqueue: EnqueueMentionRecount,
	retry = false,
): Promise<MentionRecountStatus> {
	const hash = mentionCatalogHash(await loadMentionCatalog(brandId, client));
	const existing = (
		await client.query<RecountRow>("SELECT * FROM brand_mention_recounts WHERE brand_id=$1 FOR UPDATE", [brandId])
	).rows[0];
	if (existing?.catalog_hash === hash) {
		if (retry || existing.status === "failed") {
			await client.query(
				"UPDATE brand_mention_recounts SET status='pending', error=NULL, updated_at=now(), completed_at=NULL WHERE brand_id=$1",
				[brandId],
			);
			await enqueue({ brandId, id: existing.id }, client);
			return { ...publicStatus(existing), status: "pending", error: undefined, completedAt: undefined };
		}
		return publicStatus(existing);
	}
	const id = randomUUID();
	await client.query("DELETE FROM brand_mention_recount_rows WHERE brand_id=$1", [brandId]);
	const count = await client.query<{ count: string }>(
		`SELECT count(*) FROM prompt_runs r WHERE r.brand_id=$1 AND ${eligibleRunSql}`,
		[brandId],
	);
	const total = Number(count.rows[0]?.count ?? 0);
	await client.query(
		`INSERT INTO brand_mention_recounts (brand_id,id,status,processed,total,catalog_hash) VALUES ($1,$2,'pending',0,$3,$4)
		ON CONFLICT (brand_id) DO UPDATE SET id=EXCLUDED.id,status='pending',processed=0,total=EXCLUDED.total,catalog_hash=EXCLUDED.catalog_hash,error=NULL,created_at=now(),updated_at=now(),completed_at=NULL`,
		[brandId, id, total, hash],
	);
	await enqueue({ brandId, id }, client);
	return { id, status: "pending", processed: 0, total };
}

const eligibleRunSql = `(NOT EXISTS (SELECT 1 FROM measurement_attempts ma WHERE ma.prompt_run_id=r.id AND ma.brand_id=r.brand_id AND ma.prompt_id=r.prompt_id AND ma.model=r.model)
	OR EXISTS (SELECT 1 FROM measurement_attempts ma WHERE ma.prompt_run_id=r.id AND ma.brand_id=r.brand_id AND ma.prompt_id=r.prompt_id AND ma.model=r.model AND ma.status='succeeded' AND ma.evidence->>'answerStatus'='shown'))`;

function normalizedName(name: string): string {
	return name.normalize("NFKC").trim().toLocaleLowerCase();
}
function dedupeNames(names: string[]): string[] {
	return [
		...new Map(
			names
				.map((name) => name.trim())
				.filter(Boolean)
				.map((name) => [normalizedName(name), name]),
		).values(),
	];
}
function normalizeDomain(value: string): string {
	if (!value.trim()) return "";
	try {
		const url = new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.port ||
			!url.hostname.includes(".")
		)
			throw new Error();
		return url.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		throw new Error("有効な公式ドメインを入力してください。");
	}
}

/** Add a definition and enqueue reassessment atomically; re-clicks do not duplicate competitors. */
export async function registerMentionBrand(
	input: RegisterMentionBrandInput,
	enqueue: EnqueueMentionRecount,
): Promise<{ entityId: string; recount: MentionRecountStatus }> {
	return withMentionTransaction(input.brandId, async (client) => {
		if (input.sourceRunId) {
			const source = await client.query("SELECT id FROM prompt_runs WHERE id=$1 AND brand_id=$2", [
				input.sourceRunId,
				input.brandId,
			]);
			if (!source.rows.length) throw new Error("回答が見つかりません。");
		}
		const catalog = await loadMentionCatalog(input.brandId, client);
		const name = input.name.trim();
		if (!name || name.length > 200) throw new Error("ブランド名を入力してください。");
		const domain = normalizeDomain(input.domain ?? "");
		const aliases = dedupeNames(input.aliases ?? []);
		const entities = [catalog.own, ...catalog.competitors];
		const byName = entities.find((entity) =>
			[entity.name, ...(entity.aliases ?? [])].some((n) => normalizedName(n) === normalizedName(name)),
		);
		const byDomain = domain
			? entities.find((entity) =>
					(entity.domains ?? []).some((d) => {
						try {
							return normalizeDomain(d) === domain;
						} catch {
							return false;
						}
					}),
				)
			: undefined;
		const target =
			input.target === "own"
				? catalog.own
				: input.target === "competitor"
					? catalog.competitors.find((entity) => entity.id === input.competitorId)
					: (byName ?? byDomain);
		if (input.target === "competitor" && !target) throw new Error("競合ブランドが見つかりません。");
		if (byName && target && byName.id !== target.id) throw new Error("このブランド名は別のブランドに登録済みです。");
		if (byDomain && target && byDomain.id !== target.id) throw new Error("このドメインは別のブランドに登録済みです。");
		const aliasKeys = new Set(aliases.map(normalizedName));
		if (
			entities.some(
				(entity) =>
					entity.id !== target?.id &&
					[entity.name, ...(entity.aliases ?? [])].some((n) => aliasKeys.has(normalizedName(n))),
			)
		) {
			throw new Error("この別名は別のブランドに登録済みです。");
		}
		let entityId: string;
		if (target) {
			entityId = target.id;
			const nextAliases = dedupeNames([
				...(target.aliases ?? []),
				...(normalizedName(name) === normalizedName(target.name) ? [] : [name]),
				...aliases,
			]);
			if (target.id === catalog.own.id) {
				await client.query(
					"UPDATE brands SET aliases=$2, additional_domains=CASE WHEN $3='' OR $3=ANY(additional_domains) THEN additional_domains ELSE array_append(additional_domains,$3) END, updated_at=now() WHERE id=$1",
					[input.brandId, nextAliases, domain],
				);
			} else {
				const nextDomains = [...new Set([...(target.domains ?? []), ...(domain ? [domain] : [])])];
				await client.query(
					"UPDATE competitors SET aliases=$2,domains=$3,updated_at=now() WHERE id=$1 AND brand_id=$4",
					[entityId, nextAliases, nextDomains, input.brandId],
				);
			}
		} else {
			if (catalog.competitors.length >= MAX_COMPETITORS)
				throw new Error(`競合ブランドは${MAX_COMPETITORS}件まで登録できます。`);
			entityId = randomUUID();
			await client.query("INSERT INTO competitors(id,brand_id,name,domains,aliases) VALUES($1,$2,$3,$4,$5)", [
				entityId,
				input.brandId,
				name,
				domain ? [domain] : [],
				aliases,
			]);
		}
		return { entityId, recount: await startMentionRecount(client, input.brandId, enqueue) };
	});
}

export async function retryMentionRecount(
	brandId: string,
	enqueue: EnqueueMentionRecount,
): Promise<MentionRecountStatus> {
	return withMentionTransaction(brandId, (client) => startMentionRecount(client, brandId, enqueue, true));
}

export interface MentionCompetitorInput {
	id?: string;
	name: string;
	domains: string[];
	aliases?: string[];
}

/** Preserve identifiers when the settings form replaces the list. */
export async function saveMentionCompetitors(
	brandId: string,
	entries: MentionCompetitorInput[],
	enqueue: EnqueueMentionRecount,
): Promise<void> {
	await withMentionTransaction(brandId, async (client) => {
		if (entries.length > MAX_COMPETITORS) throw new Error(`競合ブランドは${MAX_COMPETITORS}件まで登録できます。`);
		const catalog = await loadMentionCatalog(brandId, client);
		const used = new Set<string>();
		const names = new Set<string>([catalog.own.name, ...(catalog.own.aliases ?? [])].map(normalizedName));
		for (const entry of entries) {
			const name = entry.name.trim();
			if (!name) throw new Error("ブランド名を入力してください。");
			const aliases = dedupeNames(entry.aliases ?? []);
			for (const value of [name, ...aliases]) {
				if (names.has(normalizedName(value))) throw new Error("ブランド名・別名が重複しています。");
				names.add(normalizedName(value));
			}
			const domains = [...new Set(entry.domains.map(normalizeDomain).filter(Boolean))];
			const existing = entry.id
				? catalog.competitors.find((item) => item.id === entry.id)
				: catalog.competitors.find(
						(item) =>
							!used.has(item.id) &&
							(normalizedName(item.name) === normalizedName(name) ||
								(domains.length && item.domains?.some((domain) => domains.includes(normalizeDomain(domain))))),
					);
			if (entry.id && !existing) throw new Error("競合ブランドが見つかりません。");
			const id = existing?.id ?? randomUUID();
			if (used.has(id)) throw new Error("競合ブランドが重複しています。");
			used.add(id);
			await client.query(
				`INSERT INTO competitors (id,brand_id,name,domains,aliases) VALUES($1,$2,$3,$4,$5)
				ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,domains=EXCLUDED.domains,aliases=EXCLUDED.aliases,updated_at=now() WHERE competitors.brand_id=EXCLUDED.brand_id`,
				[id, brandId, name, domains, aliases],
			);
		}
		await client.query("DELETE FROM competitors WHERE brand_id=$1 AND NOT(id=ANY($2::uuid[]))", [brandId, [...used]]);
		await startMentionRecount(client, brandId, enqueue);
	});
}

interface StoredAnswer {
	id: string;
	model: string;
	provider: string | null;
	answer_text: string | null;
	raw_output: unknown;
}

/** A bounded transaction; publishing happens only when every eligible answer is staged. */
export async function processMentionRecountBatch(
	brandId: string,
	id: string,
	batchSize = 100,
): Promise<"more" | "done" | "superseded"> {
	return withMentionTransaction(brandId, async (client) => {
		const job = (
			await client.query<RecountRow>("SELECT * FROM brand_mention_recounts WHERE brand_id=$1 FOR UPDATE", [brandId])
		).rows[0];
		if (!job || job.id !== id) return "superseded";
		if (job.status === "completed") return "done";
		const catalog = await loadMentionCatalog(brandId, client);
		const hash = mentionCatalogHash(catalog);
		if (hash !== job.catalog_hash) {
			await client.query("DELETE FROM brand_mention_recount_rows WHERE brand_id=$1", [brandId]);
			await client.query("UPDATE brand_mention_recounts SET processed=0,catalog_hash=$2 WHERE brand_id=$1", [
				brandId,
				hash,
			]);
		}
		await client.query(
			"UPDATE brand_mention_recounts SET status='running',error=NULL,updated_at=now() WHERE brand_id=$1",
			[brandId],
		);
		const runs = await client.query<StoredAnswer>(
			`SELECT r.id,r.model,r.provider,
			(SELECT ma.evidence->>'answerText' FROM measurement_attempts ma WHERE ma.prompt_run_id=r.id AND ma.brand_id=r.brand_id AND ma.prompt_id=r.prompt_id AND ma.model=r.model AND ma.status='succeeded' AND ma.evidence->>'answerStatus'='shown' ORDER BY ma.completed_at DESC LIMIT 1) AS answer_text,
			CASE WHEN EXISTS(SELECT 1 FROM measurement_attempts ma WHERE ma.prompt_run_id=r.id AND ma.brand_id=r.brand_id AND ma.prompt_id=r.prompt_id AND ma.model=r.model AND ma.status='succeeded' AND ma.evidence->>'answerStatus'='shown' AND ma.evidence->>'answerText' IS NOT NULL) THEN NULL ELSE r.raw_output END AS raw_output
			FROM prompt_runs r WHERE r.brand_id=$1 AND ${eligibleRunSql}
			AND NOT EXISTS(SELECT 1 FROM brand_mention_recount_rows s WHERE s.run_id=r.id AND s.job_id=$2)
			ORDER BY r.id LIMIT $3`,
			[brandId, id, Math.min(Math.max(1, batchSize), 200)],
		);
		for (const run of runs.rows) {
			const answer = run.answer_text ?? extractTextContent(run.raw_output, run.provider ?? run.model);
			const analysis = analyzeBrandMentions(typeof answer === "string" ? answer : "", catalog);
			const flags = mentionFlags(analysis);
			await client.query(
				`INSERT INTO brand_mention_recount_rows(run_id,brand_id,job_id,analysis,brand_mentioned,competitors_mentioned) VALUES($1,$2,$3,$4,$5,$6)
				ON CONFLICT(run_id) DO UPDATE SET job_id=EXCLUDED.job_id,analysis=EXCLUDED.analysis,brand_mentioned=EXCLUDED.brand_mentioned,competitors_mentioned=EXCLUDED.competitors_mentioned`,
				[run.id, brandId, id, JSON.stringify(analysis), flags.brandMentioned, flags.competitorsMentioned],
			);
		}
		const processed = Number(
			(
				await client.query<{ count: string }>(
					"SELECT count(*) FROM brand_mention_recount_rows WHERE brand_id=$1 AND job_id=$2",
					[brandId, id],
				)
			).rows[0]?.count ?? 0,
		);
		const total = Number(
			(
				await client.query<{ count: string }>(
					`SELECT count(*) FROM prompt_runs r WHERE r.brand_id=$1 AND ${eligibleRunSql}`,
					[brandId],
				)
			).rows[0]?.count ?? 0,
		);
		await client.query("UPDATE brand_mention_recounts SET processed=$2,total=$3,updated_at=now() WHERE brand_id=$1", [
			brandId,
			processed,
			total,
		]);
		if (runs.rows.length > 0) return "more";
		// The same advisory lock is used when saving new acquisitions. No answer can
		// arrive between the final coverage check and this atomic publication.
		await client.query(
			`UPDATE prompt_runs r SET mention_analysis=s.analysis,brand_mentioned=s.brand_mentioned,competitors_mentioned=s.competitors_mentioned
			FROM brand_mention_recount_rows s WHERE s.run_id=r.id AND s.brand_id=$1 AND s.job_id=$2`,
			[brandId, id],
		);
		await client.query(
			"UPDATE brand_mention_recounts SET status='completed',completed_at=now(),updated_at=now(),error=NULL WHERE brand_id=$1 AND id=$2",
			[brandId, id],
		);
		await client.query("DELETE FROM brand_mention_recount_rows WHERE brand_id=$1 AND job_id=$2", [brandId, id]);
		return "done";
	});
}

export async function processMentionRecount(brandId: string, id: string): Promise<void> {
	try {
		while ((await processMentionRecountBatch(brandId, id)) === "more") {
			/* Bounded DB batches yield between transactions. */
		}
	} catch (error) {
		await db.$client.query(
			"UPDATE brand_mention_recounts SET status='failed',error='RECOUNT_FAILED',updated_at=now() WHERE brand_id=$1 AND id=$2 AND status<>'completed'",
			[brandId, id],
		);
		throw error;
	}
}

/** Recover a killed worker or expired queue item without depending on an open UI. */
export async function recoverMentionRecounts(enqueue: EnqueueMentionRecount): Promise<number> {
	const stale = await db.$client.query<{ brand_id: string; id: string }>(
		`SELECT brand_id,id FROM brand_mention_recounts r
		WHERE r.status IN ('pending','running') AND r.updated_at < now()-interval '5 minutes'
		AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.name=$1 AND j.data->>'brandId'=r.brand_id AND j.data->>'id'=r.id::text AND j.state IN ('created','retry','active')) LIMIT 20`,
		[MENTION_RECOUNT_QUEUE],
	);
	for (const row of stale.rows) {
		await withMentionTransaction(row.brand_id, async (client) => {
			const current = (
				await client.query<{ id: string }>(
					"SELECT id FROM brand_mention_recounts WHERE brand_id=$1 AND id=$2 AND status IN ('pending','running') AND updated_at < now()-interval '5 minutes' FOR UPDATE",
					[row.brand_id, row.id],
				)
			).rows[0];
			if (!current) return;
			await enqueue({ brandId: row.brand_id, id: current.id }, client);
			await client.query(
				"UPDATE brand_mention_recounts SET status='pending',updated_at=now() WHERE brand_id=$1 AND id=$2",
				[row.brand_id, current.id],
			);
		});
	}
	return stale.rows.length;
}
