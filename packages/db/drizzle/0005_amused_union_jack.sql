CREATE TABLE "app_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"host" text NOT NULL,
	"secret_name" text NOT NULL,
	"use_staging" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_domains_host_unique" UNIQUE("host")
);
--> statement-breakpoint
ALTER TABLE "app_domains" ADD CONSTRAINT "app_domains_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;