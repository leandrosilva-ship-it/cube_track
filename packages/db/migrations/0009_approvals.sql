CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_mode" AS ENUM('all', 'any');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "approval_approvers" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"decision" "approval_decision",
	"comment" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approval_approvers_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"requested_by" uuid,
	"mode" "approval_mode" DEFAULT 'any' NOT NULL,
	"note" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "approval_requests_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "approval_approvers" ADD CONSTRAINT "approval_approvers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_approvers" ADD CONSTRAINT "approval_approvers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_approvers" ADD CONSTRAINT "approval_approvers_request_id_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."approval_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_approvers_request_user_key" ON "approval_approvers" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "approval_approvers_user_pending_idx" ON "approval_approvers" USING btree ("tenant_id","user_id") WHERE "approval_approvers"."decided_at" is null;--> statement-breakpoint
CREATE INDEX "approval_requests_item_created_idx" ON "approval_requests" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_item_pending_idx" ON "approval_requests" USING btree ("item_id") WHERE "approval_requests"."status" = 'pending';