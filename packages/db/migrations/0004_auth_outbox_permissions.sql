CREATE TYPE "public"."auth_token_purpose" AS ENUM('magic_link', 'password_reset', 'email_verification');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('google', 'microsoft', 'saml', 'oidc');--> statement-breakpoint
ALTER TYPE "public"."resource_type" ADD VALUE 'view';--> statement-breakpoint
ALTER TYPE "public"."resource_type" ADD VALUE 'item';--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"board_id" uuid,
	"item_id" uuid,
	"user_id" uuid,
	"seq" bigint,
	"payload" jsonb NOT NULL,
	"routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"actor_kind" "actor_kind" DEFAULT 'user' NOT NULL,
	"correlation_id" text,
	"causation_id" uuid,
	"depth" smallint DEFAULT 0 NOT NULL,
	"client_mutation_id" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_events_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "family_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_method" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_pending_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_recovery_code_hashes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "views" ADD COLUMN "is_restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_board_seq_idx" ON "outbox_events" USING btree ("board_id","seq") WHERE "outbox_events"."board_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");