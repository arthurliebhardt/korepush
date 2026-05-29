ALTER TABLE "apps" ADD COLUMN "attached_db_id" uuid;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "db_env_var" text DEFAULT 'DATABASE_URL' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_attached_db_id_databases_id_fk" FOREIGN KEY ("attached_db_id") REFERENCES "public"."databases"("id") ON DELETE set null ON UPDATE no action;