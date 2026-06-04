ALTER TABLE "apps" ADD COLUMN "command" jsonb;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "args" jsonb;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "healthcheck" jsonb;