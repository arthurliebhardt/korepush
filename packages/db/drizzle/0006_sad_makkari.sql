ALTER TABLE "apps" ADD COLUMN "project_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "environment" text DEFAULT 'prod' NOT NULL;