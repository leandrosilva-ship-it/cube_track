CREATE TYPE "public"."ai_agent_run_status" AS ENUM('pending_approval', 'approved', 'rejected', 'executed', 'failed', 'reverted');--> statement-breakpoint
CREATE TYPE "public"."ai_feature" AS ENUM('assistant', 'item_create', 'summary', 'description', 'prediction', 'agent');--> statement-breakpoint
CREATE TABLE "ai_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"agent_id" uuid NOT NULL,
	"board_id" uuid,
	"item_id" uuid,
	"triggering_event_id" uuid,
	"status" "ai_agent_run_status" DEFAULT 'pending_approval' NOT NULL,
	"reasoning" text NOT NULL,
	"proposed_action" jsonb NOT NULL,
	"before_snapshot" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"executed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"reverted_by" uuid,
	CONSTRAINT "ai_agent_runs_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ai_agents_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ai_agents_allowed_actions_array" CHECK (jsonb_typeof("ai_agents"."allowed_actions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"api_key_ciphertext" text,
	"model" text DEFAULT 'claude-opus-5-5' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"monthly_token_limit" integer,
	"monthly_cost_limit_cents" integer,
	"updated_by" uuid,
	CONSTRAINT "ai_settings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ai_settings_limits" CHECK (("ai_settings"."monthly_token_limit" is null or "ai_settings"."monthly_token_limit" >= 0) and ("ai_settings"."monthly_cost_limit_cents" is null or "ai_settings"."monthly_cost_limit_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid,
	"feature" "ai_feature" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ai_usage_logs_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_agent_id_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."ai_agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_runs_agent_idx" ON "ai_agent_runs" USING btree ("agent_id","requested_at");--> statement-breakpoint
CREATE INDEX "ai_agent_runs_status_idx" ON "ai_agent_runs" USING btree ("tenant_id","status") WHERE "ai_agent_runs"."status" = 'pending_approval';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_runs_dedupe_key" ON "ai_agent_runs" USING btree ("agent_id","triggering_event_id","item_id") WHERE "ai_agent_runs"."triggering_event_id" is not null;--> statement-breakpoint
CREATE INDEX "ai_agents_board_active_idx" ON "ai_agents" USING btree ("board_id") WHERE "ai_agents"."is_active" and "ai_agents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ai_agents_trigger_type_idx" ON "ai_agents" USING btree ("tenant_id",("trigger" ->> 'type'));--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_tenant_key" ON "ai_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_tenant_created_idx" ON "ai_usage_logs" USING btree ("tenant_id","created_at");