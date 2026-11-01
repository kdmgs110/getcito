ALTER TABLE "brands" ADD COLUMN "enabled_targets" text[];
--> statement-breakpoint
CREATE TABLE "measurement_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "prompt_id" uuid NOT NULL REFERENCES "prompts"("id") ON DELETE CASCADE,
  "target_key" text NOT NULL,
  "model" text NOT NULL,
  "provider" text NOT NULL,
  "requested_version" text,
  "web_search_enabled" boolean NOT NULL,
  "iteration" integer DEFAULT 1 NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('queued','running','succeeded','failed')),
  "request_context" jsonb NOT NULL,
  "evidence" jsonb,
  "raw_output" jsonb,
  "prompt_run_id" uuid REFERENCES "prompt_runs"("id") ON DELETE SET NULL,
  "error_code" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
--> statement-breakpoint
ALTER TABLE "measurement_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_attempts_batch_target_idx" ON "measurement_attempts" ("batch_id","prompt_id","target_key","iteration");
--> statement-breakpoint
CREATE INDEX "measurement_attempts_prompt_target_idx" ON "measurement_attempts" ("prompt_id","target_key","created_at");
--> statement-breakpoint
CREATE INDEX "measurement_attempts_brand_created_idx" ON "measurement_attempts" ("brand_id","created_at");
--> statement-breakpoint
CREATE INDEX "measurement_attempts_prompt_run_idx" ON "measurement_attempts" ("prompt_run_id");
