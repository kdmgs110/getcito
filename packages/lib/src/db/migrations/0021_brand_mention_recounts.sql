ALTER TABLE "prompt_runs" ADD COLUMN "mention_analysis" jsonb;
--> statement-breakpoint
CREATE TABLE "brand_mention_recounts" (
  "brand_id" text PRIMARY KEY REFERENCES "brands"("id") ON DELETE CASCADE,
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "status" text NOT NULL DEFAULT 'pending',
  "processed" integer NOT NULL DEFAULT 0,
  "total" integer NOT NULL DEFAULT 0,
  "catalog_hash" text NOT NULL,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
--> statement-breakpoint
ALTER TABLE "brand_mention_recounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "brand_mention_recount_rows" (
  "run_id" uuid PRIMARY KEY REFERENCES "prompt_runs"("id") ON DELETE CASCADE,
  "brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL,
  "analysis" jsonb NOT NULL,
  "brand_mentioned" boolean NOT NULL,
  "competitors_mentioned" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_mention_recount_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "brand_mention_recount_rows_brand_job_idx" ON "brand_mention_recount_rows"("brand_id", "job_id");
