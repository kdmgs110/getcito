CREATE TABLE "ga4_connections" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"connected_by" text NOT NULL,
	"property_id" text,
	"property_name" text,
	"hostname" text,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ga4_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ga4_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"verifier_ciphertext" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ga4_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "traffic_query_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"connection_revision" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "traffic_query_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "traffic_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"hostname" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"filter_schema_version" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "traffic_saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ga4_connections" ADD CONSTRAINT "ga4_connections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ga4_oauth_states" ADD CONSTRAINT "ga4_oauth_states_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_query_cache" ADD CONSTRAINT "traffic_query_cache_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_saved_views" ADD CONSTRAINT "traffic_saved_views_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ga4_oauth_states_expiry_idx" ON "ga4_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "traffic_query_cache_brand_idx" ON "traffic_query_cache" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "traffic_query_cache_expiry_idx" ON "traffic_query_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_saved_views_brand_host_name_idx" ON "traffic_saved_views" USING btree ("brand_id","hostname","normalized_name");--> statement-breakpoint
CREATE INDEX "traffic_saved_views_brand_sort_idx" ON "traffic_saved_views" USING btree ("brand_id","sort_order");