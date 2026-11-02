CREATE TABLE "dataforseo_tasks" (
 "key" text PRIMARY KEY NOT NULL,
 "request_hash" text NOT NULL,
 "task_id" text,
 "status" text NOT NULL CHECK ("status" IN ('submitting','submitted','failed')),
 "error_code" text,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataforseo_tasks" ENABLE ROW LEVEL SECURITY;
