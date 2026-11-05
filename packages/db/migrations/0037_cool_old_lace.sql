CREATE TYPE "public"."payment_method_kind" AS ENUM('card', 'pix', 'boleto', 'none');--> statement-breakpoint
CREATE TYPE "public"."payment_record_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'pro', 'business', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete');--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"subscription_id" uuid NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"status" "payment_record_status" DEFAULT 'pending' NOT NULL,
	"method" "payment_method_kind" NOT NULL,
	"provider_reference_id" text,
	"description" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payment_records_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"plan" "plan_tier" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'none' NOT NULL,
	"payment_method" "payment_method_kind" DEFAULT 'none' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "subscriptions_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'free'::"public"."plan_tier";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DATA TYPE "public"."plan_tier" USING "plan"::"public"."plan_tier";--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_subscription_id_fk" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."subscriptions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_records_tenant_subscription_idx" ON "payment_records" USING btree ("tenant_id","subscription_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_tenant_provider_ref_key" ON "payment_records" USING btree ("tenant_id","provider_reference_id") WHERE "payment_records"."provider_reference_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_key" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_customer_key" ON "subscriptions" USING btree ("stripe_customer_id") WHERE "subscriptions"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_key" ON "subscriptions" USING btree ("stripe_subscription_id") WHERE "subscriptions"."stripe_subscription_id" is not null;