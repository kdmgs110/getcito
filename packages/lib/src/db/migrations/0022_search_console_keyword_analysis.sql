
CREATE TABLE "gsc_connections" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"connected_by" text NOT NULL,
	"property_id" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gsc_oauth_states" (
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
ALTER TABLE "gsc_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gsc_query_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"connection_revision" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_query_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_oauth_states" ADD CONSTRAINT "gsc_oauth_states_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_cache" ADD CONSTRAINT "gsc_query_cache_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gsc_oauth_states_expiry_idx" ON "gsc_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "gsc_query_cache_brand_idx" ON "gsc_query_cache" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "gsc_query_cache_expiry_idx" ON "gsc_query_cache" USING btree ("expires_at");
