CREATE TABLE "github_app" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"client_id" text,
	"client_secret" text,
	"html_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
