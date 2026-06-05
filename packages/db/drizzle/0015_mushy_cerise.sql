ALTER TABLE "apps" DROP CONSTRAINT "apps_github_installation_id_github_installations_id_fk";
--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_github_installation_id_github_installations_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("id") ON DELETE set null ON UPDATE no action;