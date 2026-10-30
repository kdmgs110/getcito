import {
	boolean,
	index,
	integer,
	json,
	jsonb,
	pgEnum,
	pgTable,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { AnalyticsMeasurementMode, TrafficCondition } from "../analytics/types";

// Better-auth tables & relations — re-exported so `import * as schema` sees everything.
// Source file is auto-generated; run `pnpm run generate:auth-schema` to refresh.
export * from "./schema-auth";

// ============================================================================
// Application tables
// ============================================================================

export const reportStatusEnum = pgEnum("report_status", ["pending", "processing", "completed", "failed"]);

export const brands = pgTable("brands", {
	id: text("id").primaryKey().notNull(),
	name: text("name").notNull(),
	website: text("website").notNull(),
	additionalDomains: text("additional_domains").array().notNull().default([]),
	aliases: text("aliases").array().notNull().default([]),
	enabled: boolean("enabled").default(true).notNull(),
	onboarded: boolean("onboarded").default(false).notNull(),
	delayOverrideHours: integer("delay_override_hours"),
	enabledModels: text("enabled_models").array(),
	targetMarket: text("target_market"),
	targetLanguage: text("target_language"),
	shortDescription: text("short_description"),
	productsAndServices: text("products_and_services").array().notNull().default([]),
	keywords: text("keywords").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();

/** One Google Analytics integration per brand. Credentials never leave the server. */
export const ga4Connections = pgTable("ga4_connections", {
	brandId: text("brand_id")
		.primaryKey()
		.references(() => brands.id, { onDelete: "cascade" }),
	refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
	connectedBy: text("connected_by").notNull(),
	propertyId: text("property_id"),
	propertyName: text("property_name"),
	hostname: text("hostname"),
	timeZone: text("time_zone").default("UTC").notNull(),
	measurementMode: text("measurement_mode").$type<AnalyticsMeasurementMode>().default("landing_sessions").notNull(),
	status: text("status").default("connected").notNull(),
	revision: uuid("revision").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/** Short-lived, one-time OAuth state bound to both the current user and session. */
export const ga4OAuthStates = pgTable(
	"ga4_oauth_states",
	{
		stateHash: text("state_hash").primaryKey(),
		brandId: text("brand_id")
			.notNull()
			.references(() => brands.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull(),
		sessionId: text("session_id").notNull(),
		verifierCiphertext: text("verifier_ciphertext").notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("ga4_oauth_states_expiry_idx").on(table.expiresAt)],
).enableRLS();

export const trafficSavedViews = pgTable(
	"traffic_saved_views",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		brandId: text("brand_id")
			.notNull()
			.references(() => brands.id, { onDelete: "cascade" }),
		hostname: text("hostname").notNull(),
		name: text("name").notNull(),
		normalizedName: text("normalized_name").notNull(),
		conditions: jsonb("conditions").$type<TrafficCondition[]>().notNull(),
		filterSchemaVersion: integer("filter_schema_version").default(1).notNull(),
		sortOrder: integer("sort_order").default(0).notNull(),
		revision: integer("revision").default(1).notNull(),
		createdBy: text("created_by").notNull(),
		updatedBy: text("updated_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("traffic_saved_views_brand_host_name_idx").on(table.brandId, table.hostname, table.normalizedName),
		index("traffic_saved_views_brand_sort_idx").on(table.brandId, table.sortOrder),
	],
).enableRLS();

export const trafficQueryCache = pgTable(
	"traffic_query_cache",
	{
		cacheKey: text("cache_key").primaryKey(),
		brandId: text("brand_id")
			.notNull()
			.references(() => brands.id, { onDelete: "cascade" }),
		connectionRevision: uuid("connection_revision").notNull(),
		payload: jsonb("payload").notNull(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		index("traffic_query_cache_brand_idx").on(table.brandId),
		index("traffic_query_cache_expiry_idx").on(table.expiresAt),
	],
).enableRLS();

export const prompts = pgTable(
	"prompts",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		value: text("value").notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		tags: text("tags").array().notNull().default([]),
		systemTags: text("system_tags").array().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		brandIdIdx: index("prompts_brand_id_idx").on(table.brandId),
		brandIdEnabledIdx: index("prompts_brand_id_enabled_idx").on(table.brandId, table.enabled),
	}),
).enableRLS();

export const competitors = pgTable("competitors", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id)
		.notNull(),
	name: text("name").notNull(),
	domains: text("domains").array().notNull().default([]),
	aliases: text("aliases").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();

export const promptRuns = pgTable(
	"prompt_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id)
			.notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		model: text("model").notNull(),
		provider: text("provider"),
		version: text("version").notNull(),
		webSearchEnabled: boolean("web_search_enabled").notNull(),
		rawOutput: json("raw_output").notNull(),
		webQueries: text("web_queries").array().notNull().default([]),
		brandMentioned: boolean("brand_mentioned").notNull(),
		competitorsMentioned: text("competitors_mentioned").array().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		promptIdCreatedAtIdx: index("prompt_runs_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		createdAtIdx: index("prompt_runs_created_at_idx").on(table.createdAt),
		webSearchCreatedAtIdx: index("prompt_runs_web_search_created_at_idx").on(table.webSearchEnabled, table.createdAt),
		webSearchModelCreatedAtIdx: index("prompt_runs_web_search_model_created_at_idx").on(
			table.webSearchEnabled,
			table.model,
			table.createdAt,
		),
		providerIdx: index("prompt_runs_provider_idx").on(table.provider),
		modelCreatedAtIdx: index("prompt_runs_model_created_at_idx").on(table.model, table.createdAt),
		// Deleting a brand deletes its runs by brand_id; without this the delete
		// sequentially scans the largest table in the schema.
		brandIdIdx: index("prompt_runs_brand_id_idx").on(table.brandId),
	}),
).enableRLS();

export const citations = pgTable(
	"citations",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		promptRunId: uuid("prompt_run_id")
			.references(() => promptRuns.id)
			.notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id)
			.notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		model: text("model").notNull(),
		url: text("url").notNull(),
		domain: text("domain").notNull(),
		title: text("title"),
		citationIndex: smallint("citation_index").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		brandAnalyticsIdx: index("idx_citations_brand_analytics").on(
			table.brandId,
			table.createdAt,
			table.url,
			table.domain,
			table.title,
			table.promptId,
			table.model,
		),
		promptCreatedIdx: index("citations_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		domainIdx: index("citations_domain_idx").on(table.domain),
		// Postgres does not index foreign keys automatically. Every `prompt_runs`
		// delete has to prove no citation still references the row, so without this
		// index a brand delete scans all of `citations` once per deleted run.
		promptRunIdIdx: index("citations_prompt_run_id_idx").on(table.promptRunId),
	}),
).enableRLS();

export const reports = pgTable(
	"reports",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandName: text("brand_name").notNull(),
		brandWebsite: text("brand_website").notNull(),
		status: reportStatusEnum().notNull().default("pending"),
		progress: integer("progress").notNull().default(0),
		rawOutput: json("raw_output"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		createdAtIdx: index("reports_created_at_idx").on(table.createdAt),
	}),
).enableRLS();

// One row per generated Opportunities report, per brand — append-only history
// (every generation is kept, not overwritten). The page reads the latest row and
// regenerates only when it's stale; see apps/web/src/server/opportunities.ts.
export const brandOpportunities = pgTable(
	"brand_opportunities",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		/** The full enriched opportunities report the page renders (OpportunitiesReport JSON). */
		report: json("report").notNull(),
		/** Model/provider that generated it, when known. */
		model: text("model"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		brandCreatedIdx: index("brand_opportunities_brand_id_created_at_idx").on(table.brandId, table.createdAt),
	}),
).enableRLS();

export type BrandOpportunity = typeof brandOpportunities.$inferSelect;
export type NewBrandOpportunity = typeof brandOpportunities.$inferInsert;

/**
 * One row per billable upstream provider call, for reconciling our usage
 * against a vendor's invoice.
 *
 * A row is written per `Provider.run()` / `runStructuredResearch()` — one
 * scrape or one completion — not per outbound HTTP request. Olostep's batch
 * flow polls status every 5s and then fetches the result, but bills for the
 * scrape, so counting HTTP requests would overstate usage by roughly 10x.
 *
 * Failed calls are recorded too: a provider that errors after the upstream
 * work has started is still billed, and a run that fails stores no prompt_runs
 * row, so this table is the only place that count exists.
 *
 * No foreign key on brand_id — this is an append-only log that must outlive
 * the brand it was run for.
 */
export const providerCalls = pgTable(
	"provider_calls",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		/** Provider id from the registry, e.g. "olostep". */
		provider: text("provider").notNull(),
		/** Tracked model, e.g. "chatgpt". */
		model: text("model").notNull(),
		/** "run" for a tracked prompt/report run, "research" for onboarding analysis. */
		kind: text("kind").notNull(),
		brandId: text("brand_id"),
		/**
		 * The tracked prompt this call was made for, so a slow model can be traced to
		 * the prompt it was slow on. Null for report runs (no stored prompt) and for
		 * onboarding research. No foreign key, for the same reason `brand_id` has none.
		 */
		promptId: uuid("prompt_id"),
		success: boolean("success").notNull(),
		errorMessage: text("error_message"),
		durationMs: integer("duration_ms"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		providerCreatedIdx: index("provider_calls_provider_created_at_idx").on(table.provider, table.createdAt),
		promptCreatedIdx: index("provider_calls_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		providerModelCreatedIdx: index("provider_calls_provider_model_created_at_idx").on(
			table.provider,
			table.model,
			table.createdAt,
		),
	}),
).enableRLS();

export type ProviderCall = typeof providerCalls.$inferSelect;
export type NewProviderCall = typeof providerCalls.$inferInsert;

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;

export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;

export type PromptRun = typeof promptRuns.$inferSelect;
export type NewPromptRun = typeof promptRuns.$inferInsert;

export type BrandWithPrompts = Brand & {
	prompts: Prompt[];
	competitors: Competitor[];
};

export type CitationRecord = typeof citations.$inferSelect;
export type NewCitationRecord = typeof citations.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export const SYSTEM_TAGS = {
	BRANDED: "branded",
	UNBRANDED: "unbranded",
} as const;

export type SystemTag = (typeof SYSTEM_TAGS)[keyof typeof SYSTEM_TAGS];
