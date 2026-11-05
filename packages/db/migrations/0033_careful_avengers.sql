CREATE TYPE "public"."consent_purpose" AS ENUM('marketing_email', 'product_analytics', 'ai_processing');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_kind" AS ENUM('export', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_status" AS ENUM('requested', 'approved', 'executed', 'rejected');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	CONSTRAINT "consent_records_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"kind" "data_subject_request_kind" NOT NULL,
	"status" "data_subject_request_status" DEFAULT 'requested' NOT NULL,
	"reason" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"export_storage_key" text,
	CONSTRAINT "data_subject_requests_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "security_policies" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"password_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_restriction" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "security_policies_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sso_configurations" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"idp_entity_id" text NOT NULL,
	"idp_sso_url" text NOT NULL,
	"idp_slo_url" text,
	"idp_certificate_ciphertext" text NOT NULL,
	"metadata_url" text,
	"attribute_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provision_on_first_login" boolean DEFAULT true NOT NULL,
	"default_role_key" text DEFAULT 'guest' NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "sso_configurations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "org_unit" text;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_policies" ADD CONSTRAINT "security_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_policies" ADD CONSTRAINT "security_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_configurations" ADD CONSTRAINT "sso_configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_configurations" ADD CONSTRAINT "sso_configurations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_tenant_user_idx" ON "consent_records" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_subject_requests_tenant_user_idx" ON "data_subject_requests" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "security_policies_tenant_key" ON "security_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_configurations_tenant_key" ON "sso_configurations" USING btree ("tenant_id");