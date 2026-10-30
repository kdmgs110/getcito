CREATE TABLE "conversion_goals" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "brand_id" text NOT NULL,
 "property_id" text NOT NULL,
 "hostname" text NOT NULL,
 "event_name" text NOT NULL,
 "display_name" text NOT NULL,
 "enabled" boolean DEFAULT true NOT NULL,
 "ga4_name" text NOT NULL,
 "ga4_create_time" timestamp with time zone,
 "counting_method" text NOT NULL,
 "revision" integer DEFAULT 1 NOT NULL,
 "created_by" text NOT NULL,
 "updated_by" text NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversion_goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversion_goals" ADD CONSTRAINT "conversion_goals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_goals_brand_property_host_event_idx" ON "conversion_goals" USING btree ("brand_id","property_id","hostname","event_name");
--> statement-breakpoint
CREATE INDEX "conversion_goals_brand_idx" ON "conversion_goals" USING btree ("brand_id");
--> statement-breakpoint
ALTER TABLE "traffic_saved_views" ADD COLUMN "conversion_goal_id" uuid;
--> statement-breakpoint
ALTER TABLE "traffic_saved_views" ADD COLUMN "analysis_tab" text DEFAULT 'traffic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "traffic_saved_views" ADD CONSTRAINT "traffic_saved_views_conversion_goal_id_conversion_goals_id_fk" FOREIGN KEY ("conversion_goal_id") REFERENCES "public"."conversion_goals"("id") ON DELETE set null ON UPDATE no action;
