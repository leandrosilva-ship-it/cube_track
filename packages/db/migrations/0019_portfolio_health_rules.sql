CREATE TYPE "public"."scoring_method" AS ENUM('weighted', 'wsjf');--> statement-breakpoint
CREATE TABLE "health_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid,
	"rules" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_rule_sets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "health_rule_sets_rules_array" CHECK (jsonb_typeof("health_rule_sets"."rules") = 'array')
);
--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "is_automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "planned_value" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "earned_value" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "actual_cost" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "eac" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "project_health" ADD COLUMN "vac" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "scoring_models" ADD COLUMN "method" "scoring_method" DEFAULT 'weighted' NOT NULL;--> statement-breakpoint
ALTER TABLE "health_rule_sets" ADD CONSTRAINT "health_rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_rule_sets" ADD CONSTRAINT "health_rule_sets_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_rule_sets_tenant_default_key" ON "health_rule_sets" USING btree ("tenant_id") WHERE "health_rule_sets"."board_id" is null and "health_rule_sets"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "health_rule_sets_board_key" ON "health_rule_sets" USING btree ("board_id") WHERE "health_rule_sets"."board_id" is not null and "health_rule_sets"."deleted_at" is null;