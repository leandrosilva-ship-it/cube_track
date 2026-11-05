CREATE TABLE "integration_apps" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_ciphertext" text NOT NULL,
	"redirect_uri" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "integration_apps_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "integration_apps" ADD CONSTRAINT "integration_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_apps" ADD CONSTRAINT "integration_apps_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_apps_workspace_provider_key" ON "integration_apps" USING btree ("tenant_id","workspace_id","provider") WHERE "integration_apps"."deleted_at" is null;