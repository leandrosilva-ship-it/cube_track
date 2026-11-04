CREATE TYPE "public"."import_job_status" AS ENUM('uploaded', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('csv', 'monday', 'trello', 'jira', 'pipefy');--> statement-breakpoint
CREATE TYPE "public"."integration_auth_kind" AS ENUM('oauth', 'webhook_secret');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('google', 'microsoft', 'slack', 'teams', 'github', 'gitlab', 'azure_devops');--> statement-breakpoint
ALTER TYPE "public"."notification_channel" ADD VALUE 'slack';--> statement-breakpoint
ALTER TYPE "public"."notification_channel" ADD VALUE 'teams';--> statement-breakpoint
CREATE TABLE "oauth_apps" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"description" text,
	"client_id" text NOT NULL,
	"client_secret_ciphertext" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "oauth_apps_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "oauth_apps_name_len" CHECK (char_length("oauth_apps"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_job_status" DEFAULT 'uploaded' NOT NULL,
	"file_name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"total_rows" integer NOT NULL,
	"created_count" integer,
	"skipped_count" integer,
	"error_report" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_links" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"item_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"external_calendar_id" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_links_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "dev_event_links" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"item_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"board_id" uuid,
	"kind" text NOT NULL,
	"repo" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author_name" text NOT NULL,
	CONSTRAINT "dev_event_links_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "external_file_links" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"item_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_file_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"mime_type" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "external_file_links_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"auth_kind" "integration_auth_kind" NOT NULL,
	"user_id" uuid,
	"access_token_ciphertext" text,
	"refresh_token_ciphertext" text,
	"token_expires_at" timestamp with time zone,
	"webhook_secret_ciphertext" text,
	"outbound_webhook_url_ciphertext" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "integration_connections_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "oauth_app_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_links" ADD CONSTRAINT "calendar_sync_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_links" ADD CONSTRAINT "calendar_sync_links_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_links" ADD CONSTRAINT "calendar_sync_links_connection_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."integration_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_event_links" ADD CONSTRAINT "dev_event_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_event_links" ADD CONSTRAINT "dev_event_links_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_event_links" ADD CONSTRAINT "dev_event_links_connection_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."integration_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_event_links" ADD CONSTRAINT "dev_event_links_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_file_links" ADD CONSTRAINT "external_file_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_file_links" ADD CONSTRAINT "external_file_links_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_file_links" ADD CONSTRAINT "external_file_links_connection_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."integration_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_apps_client_id_key" ON "oauth_apps" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sync_links_item_connection_key" ON "calendar_sync_links" USING btree ("item_id","connection_id");--> statement-breakpoint
CREATE INDEX "dev_event_links_item_idx" ON "dev_event_links" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "external_file_links_item_idx" ON "external_file_links" USING btree ("item_id") WHERE "external_file_links"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_per_user_key" ON "integration_connections" USING btree ("tenant_id","workspace_id","provider","user_id") WHERE "integration_connections"."deleted_at" is null and "integration_connections"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_per_workspace_key" ON "integration_connections" USING btree ("tenant_id","workspace_id","provider") WHERE "integration_connections"."deleted_at" is null and "integration_connections"."user_id" is null;--> statement-breakpoint
CREATE INDEX "integration_connections_workspace_idx" ON "integration_connections" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_oauth_app_id_fk" FOREIGN KEY ("tenant_id","oauth_app_id") REFERENCES "public"."oauth_apps"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_app_idx" ON "api_tokens" USING btree ("tenant_id","oauth_app_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_owner_xor" CHECK (("api_tokens"."user_id" is null) <> ("api_tokens"."oauth_app_id" is null));