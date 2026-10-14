CREATE TYPE "public"."absence_type" AS ENUM('vacation', 'sick_leave', 'training', 'day_off', 'other');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('user', 'automation', 'api', 'import', 'system');--> statement-breakpoint
CREATE TYPE "public"."allocation_status" AS ENUM('tentative', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."board_kind" AS ENUM('board', 'project', 'process', 'backlog');--> statement-breakpoint
CREATE TYPE "public"."board_visibility" AS ENUM('main', 'private', 'shareable');--> statement-breakpoint
CREATE TYPE "public"."budget_category" AS ENUM('capex', 'opex');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cost_kind" AS ENUM('planned', 'actual', 'forecast');--> statement-breakpoint
CREATE TYPE "public"."cost_source" AS ENUM('manual', 'timesheet', 'invoice', 'import');--> statement-breakpoint
CREATE TYPE "public"."dashboard_visibility" AS ENUM('private', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."dependency_type" AS ENUM('FS', 'SS', 'FF', 'SF');--> statement-breakpoint
CREATE TYPE "public"."favorite_entity" AS ENUM('workspace', 'folder', 'board', 'dashboard', 'item', 'portfolio', 'program');--> statement-breakpoint
CREATE TYPE "public"."folder_kind" AS ENUM('regular', 'templates');--> statement-breakpoint
CREATE TYPE "public"."follow_entity" AS ENUM('board', 'item', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('green', 'yellow', 'red', 'grey');--> statement-breakpoint
CREATE TYPE "public"."holiday_scope" AS ENUM('national', 'state', 'municipal', 'company');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('proposed', 'planning', 'active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."measurement_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."membership_kind" AS ENUM('member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."mention_source" AS ENUM('update', 'reply', 'item_description');--> statement-breakpoint
CREATE TYPE "public"."mention_target" AS ENUM('user', 'team', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'achieved', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_frequency" AS ENUM('instant', 'hourly', 'daily', 'weekly', 'never');--> statement-breakpoint
CREATE TYPE "public"."phase_kind" AS ENUM('start', 'intermediate', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('user', 'team');--> statement-breakpoint
CREATE TYPE "public"."resource_request_status" AS ENUM('open', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('workspace', 'folder', 'portfolio', 'program', 'board', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."retention_action" AS ENUM('delete', 'anonymize', 'archive');--> statement-breakpoint
CREATE TYPE "public"."risk_status" AS ENUM('open', 'mitigating', 'occurred', 'closed');--> statement-breakpoint
CREATE TYPE "public"."risk_strategy" AS ENUM('avoid', 'mitigate', 'transfer', 'accept');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('tenant', 'workspace', 'board');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."service_order_status" AS ENUM('draft', 'requested', 'issued', 'in_progress', 'delivered', 'accepted', 'measured', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."share_resource" AS ENUM('board', 'view', 'dashboard', 'form');--> statement-breakpoint
CREATE TYPE "public"."sla_event_type" AS ENUM('started', 'paused', 'resumed', 'warning', 'breached', 'met', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."sla_tracker_status" AS ENUM('running', 'paused', 'met', 'breached', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."sprint_state" AS ENUM('planned', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('not_started', 'in_progress', 'done', 'stuck');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('workspace', 'board', 'item', 'automation', 'dashboard', 'form');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."time_entry_source" AS ENUM('manual', 'timer', 'import', 'api');--> statement-breakpoint
CREATE TYPE "public"."update_target" AS ENUM('update', 'reply');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'suspended', 'anonymized');--> statement-breakpoint
CREATE TYPE "public"."view_type" AS ENUM('table', 'kanban', 'calendar', 'timeline', 'gantt', 'form', 'map', 'chart', 'files', 'workload', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."workspace_visibility" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text,
	"document" text,
	"plan" text DEFAULT 'enterprise' NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"data_region" text DEFAULT 'br' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"automation_id" uuid NOT NULL,
	"trigger_event_id" uuid,
	"item_id" uuid,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "automation_runs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "automation_runs_depth" CHECK ("automation_runs"."depth" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb,
	"actions" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"owner_id" uuid,
	"template_key" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "automations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "automations_actions_array" CHECK (jsonb_typeof("automations"."actions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"response_status" smallint,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"next_retry_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "webhook_deliveries_response_body_len" CHECK (char_length("webhook_deliveries"."response_body") <= 4096)
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid,
	"board_id" uuid,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"events" text[] NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "webhooks_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "webhooks_https" CHECK ("webhooks"."url" ~ '^https://'),
	CONSTRAINT "webhooks_events_not_empty" CHECK (cardinality("webhooks"."events") > 0)
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid,
	"item_id" uuid,
	"actor_id" uuid,
	"actor_kind" "actor_kind" DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"column_key" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "activity_logs_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"attachment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	CONSTRAINT "attachment_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attachment_versions_size" CHECK ("attachment_versions"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid,
	"item_id" uuid,
	"update_id" uuid,
	"reply_id" uuid,
	"file_name" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"entity_type" "follow_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "follows_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"source_type" "mention_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"target_type" "mention_target" NOT NULL,
	"target_id" uuid,
	CONSTRAINT "mentions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "mentions_target_required" CHECK ("mentions"."target_type" = 'everyone' or "mentions"."target_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"event_type" text DEFAULT '*' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequency" "notification_frequency" DEFAULT 'instant' NOT NULL,
	CONSTRAINT "notification_preferences_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"actor_id" uuid,
	"board_id" uuid,
	"item_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "notifications_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"target_type" "update_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "reactions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "reactions_emoji_len" CHECK (char_length("reactions"."emoji") between 1 and 32)
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"update_id" uuid NOT NULL,
	"author_id" uuid,
	"body" jsonb NOT NULL,
	"body_text" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "replies_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "updates" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"author_id" uuid,
	"body" jsonb NOT NULL,
	"body_text" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "updates_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "column_definitions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"binding" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"required_when" jsonb,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"width" integer,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "column_definitions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "column_definitions_key_format" CHECK ("column_definitions"."key" ~ '^[a-z][a-z0-9_]{1,62}$'),
	CONSTRAINT "column_definitions_width" CHECK ("column_definitions"."width" is null or "column_definitions"."width" between 40 and 2000)
);
--> statement-breakpoint
CREATE TABLE "dropdown_options" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"column_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dropdown_options_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "status_labels" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"column_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"category" "status_category" DEFAULT 'not_started' NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "status_labels_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "status_labels_color" CHECK ("status_labels"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"client_name" text NOT NULL,
	"client_document" text,
	"object" text,
	"sei_process" text,
	"bidding_reference" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"ust_unit_price" numeric(18, 4) NOT NULL,
	"ust_contracted" numeric(18, 4) NOT NULL,
	"total_value" numeric(18, 4) NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"manager_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contracts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contracts_dates" CHECK ("contracts"."end_date" >= "contracts"."start_date"),
	CONSTRAINT "contracts_values" CHECK ("contracts"."ust_unit_price" >= 0 and "contracts"."ust_contracted" >= 0 and "contracts"."total_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"measurement_id" uuid,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"amount" numeric(18, 4) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"paid_at" date,
	"nfe_key" text,
	CONSTRAINT "invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_amount" CHECK ("invoices"."amount" >= 0),
	CONSTRAINT "invoices_nfe_key" CHECK ("invoices"."nfe_key" is null or "invoices"."nfe_key" ~ '^[0-9]{44}$')
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"service_order_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"measured_ust" numeric(18, 4) NOT NULL,
	"glosa_ust" numeric(18, 4) DEFAULT '0' NOT NULL,
	"approved_ust" numeric(18, 4),
	"amount" numeric(18, 4),
	"status" "measurement_status" DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "measurements_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "measurements_dates" CHECK ("measurements"."period_end" >= "measurements"."period_start"),
	CONSTRAINT "measurements_glosa" CHECK ("measurements"."glosa_ust" >= 0 and "measurements"."glosa_ust" <= "measurements"."measured_ust")
);
--> statement-breakpoint
CREATE TABLE "service_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"default_ust" numeric(18, 4) NOT NULL,
	"unit" text DEFAULT 'serviço' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_catalog_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_catalog_items_ust" CHECK ("service_catalog_items"."default_ust" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_order_items" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"service_order_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"quantity" numeric(12, 4) DEFAULT '1' NOT NULL,
	"ust_unit" numeric(18, 4) NOT NULL,
	"ust_total" numeric(18, 4) NOT NULL,
	"description" text,
	CONSTRAINT "service_order_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_order_items_quantity" CHECK ("service_order_items"."quantity" > 0),
	CONSTRAINT "service_order_items_total" CHECK ("service_order_items"."ust_total" = round("service_order_items"."quantity" * "service_order_items"."ust_unit", 4))
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"board_id" uuid,
	"item_id" uuid,
	"number" text NOT NULL,
	"sei_process" text,
	"description" text,
	"status" "service_order_status" DEFAULT 'draft' NOT NULL,
	"requested_at" date,
	"issued_at" date,
	"start_date" date,
	"planned_end_date" date,
	"delivered_at" date,
	"accepted_at" date,
	"billed_at" date,
	"total_ust" numeric(18, 4) DEFAULT '0' NOT NULL,
	"requester_name" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "service_orders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_orders_ust" CHECK ("service_orders"."total_ust" >= 0),
	CONSTRAINT "service_orders_dates" CHECK ("service_orders"."issued_at" is null or "service_orders"."requested_at" is null or "service_orders"."issued_at" >= "service_orders"."requested_at")
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"visibility" "dashboard_visibility" DEFAULT 'workspace' NOT NULL,
	"source_board_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"filters" jsonb,
	"refresh_interval_seconds" integer,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dashboards_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dashboards_refresh" CHECK ("dashboards"."refresh_interval_seconds" is null or "dashboards"."refresh_interval_seconds" >= 30)
);
--> statement-breakpoint
CREATE TABLE "widgets" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"dashboard_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"layout" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "widgets_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"form_id" uuid NOT NULL,
	"column_key" text,
	"label" text NOT NULL,
	"help_text" text,
	"field_type" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"show_when" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "form_fields_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"form_id" uuid NOT NULL,
	"item_id" uuid,
	"submitted_by" uuid,
	"submitter_email" text,
	"data" jsonb NOT NULL,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "form_submissions_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"target_group_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_token_hash" text,
	"requires_login" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"closes_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "forms_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "forms_public_token" CHECK (not "forms"."is_public" or "forms"."public_token_hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_chain_heads" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"entity_type" text NOT NULL,
	"retention_days" integer NOT NULL,
	"action" "retention_action" NOT NULL,
	"legal_basis" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_applied_at" timestamp with time zone,
	CONSTRAINT "data_retention_policies_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "data_retention_policies_days" CHECK ("data_retention_policies"."retention_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid,
	"workspace_id" uuid,
	"kind" "template_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"thumbnail_url" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"resource_type" "resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"principal_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "access_grants_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" "inet",
	"revoked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "api_tokens_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "api_tokens_prefix_len" CHECK (char_length("api_tokens"."token_prefix") between 4 and 16)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"kind" "membership_kind" DEFAULT 'member' NOT NULL,
	"resource_type" "resource_type",
	"resource_id" uuid,
	"resource_role_id" uuid,
	"token_hash" text NOT NULL,
	"message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"kind" "membership_kind" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"job_title" text,
	"joined_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memberships_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" "role_scope" NOT NULL,
	"module" text DEFAULT 'core' NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" "role_scope" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "roles_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "sessions_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	CONSTRAINT "team_members_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"description" text,
	"avatar_url" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "teams_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"identity_provider" text,
	"external_subject" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "baseline_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"baseline_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"start_date" date,
	"end_date" date,
	"duration_days" integer,
	"progress" numeric(5, 2),
	"estimate_hours" numeric(10, 2),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "baseline_snapshots_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "baselines_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "dependencies" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"successor_id" uuid NOT NULL,
	"type" "dependency_type" DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dependencies_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dependencies_not_self" CHECK ("dependencies"."predecessor_id" <> "dependencies"."successor_id"),
	CONSTRAINT "dependencies_lag_range" CHECK ("dependencies"."lag_days" between -3650 and 3650)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid,
	"calendar_id" uuid,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"scope" "holiday_scope" NOT NULL,
	"state_code" text,
	"city_ibge_code" text,
	"is_optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "holidays_global_scope" CHECK ("holidays"."tenant_id" is not null or "holidays"."scope" <> 'company'),
	CONSTRAINT "holidays_locality" CHECK (("holidays"."scope" <> 'state' or "holidays"."state_code" is not null) and ("holidays"."scope" <> 'municipal' or "holidays"."city_ibge_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"due_date" date NOT NULL,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"achieved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "milestones_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"state" "sprint_state" DEFAULT 'planned' NOT NULL,
	"capacity_points" numeric(8, 2),
	"position" text COLLATE "C" NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sprints_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sprints_dates" CHECK ("sprints"."end_date" >= "sprints"."start_date")
);
--> statement-breakpoint
CREATE TABLE "work_calendars" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"working_days" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
	"hours_per_day" numeric(4, 2) DEFAULT '8' NOT NULL,
	"work_start" time DEFAULT '09:00' NOT NULL,
	"work_end" time DEFAULT '18:00' NOT NULL,
	"state_code" text,
	"city_ibge_code" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_calendars_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_calendars_working_days" CHECK ("work_calendars"."working_days" <@ '{1,2,3,4,5,6,7}'::smallint[]),
	CONSTRAINT "work_calendars_state_code" CHECK ("work_calendars"."state_code" is null or "work_calendars"."state_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid,
	"program_id" uuid,
	"portfolio_id" uuid,
	"name" text NOT NULL,
	"category" "budget_category" DEFAULT 'opex' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"planned_amount" numeric(18, 4) NOT NULL,
	"fiscal_year" integer,
	"period_start" date,
	"period_end" date,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budgets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "budgets_single_owner" CHECK (num_nonnulls("budgets"."board_id", "budgets"."program_id", "budgets"."portfolio_id") = 1),
	CONSTRAINT "budgets_amount" CHECK ("budgets"."planned_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"budget_id" uuid NOT NULL,
	"board_id" uuid,
	"item_id" uuid,
	"entry_date" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"kind" "cost_kind" DEFAULT 'actual' NOT NULL,
	"source" "cost_source" DEFAULT 'manual' NOT NULL,
	"category" text,
	"description" text,
	"reference" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cost_entries_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"item_id" uuid,
	"risk_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"severity" "issue_severity" DEFAULT 'medium' NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "issues_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid,
	"scoring_model_id" uuid,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "portfolios_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"portfolio_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "programs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "programs_dates" CHECK ("programs"."end_date" is null or "programs"."start_date" is null or "programs"."end_date" >= "programs"."start_date")
);
--> statement-breakpoint
CREATE TABLE "project_health" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"reported_by" uuid,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overall" "health_status" NOT NULL,
	"schedule" "health_status" DEFAULT 'grey' NOT NULL,
	"cost" "health_status" DEFAULT 'grey' NOT NULL,
	"scope" "health_status" DEFAULT 'grey' NOT NULL,
	"quality" "health_status" DEFAULT 'grey' NOT NULL,
	"risk" "health_status" DEFAULT 'grey' NOT NULL,
	"percent_complete" numeric(5, 2),
	"spi" numeric(6, 3),
	"cpi" numeric(6, 3),
	"summary" text,
	CONSTRAINT "project_health_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_health_percent" CHECK ("project_health"."percent_complete" is null or "project_health"."percent_complete" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"item_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"probability" smallint NOT NULL,
	"impact" smallint NOT NULL,
	"status" "risk_status" DEFAULT 'open' NOT NULL,
	"strategy" "risk_strategy",
	"mitigation_plan" text,
	"contingency_plan" text,
	"owner_id" uuid,
	"due_date" date,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "risks_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "risks_probability" CHECK ("risks"."probability" between 1 and 5),
	CONSTRAINT "risks_impact" CHECK ("risks"."impact" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"scoring_model_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"criteria_scores" jsonb NOT NULL,
	"total_score" numeric(10, 4) NOT NULL,
	"scored_by" uuid,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rationale" text,
	CONSTRAINT "scores_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "scoring_models" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"description" text,
	"criteria" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "scoring_models_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "scoring_models_criteria_array" CHECK (jsonb_typeof("scoring_models"."criteria") = 'array')
);
--> statement-breakpoint
CREATE TABLE "stage_gates" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"status" "gate_status" DEFAULT 'pending' NOT NULL,
	"due_date" date,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "stage_gates_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "phase_transition_rules" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"pipe_id" uuid NOT NULL,
	"from_phase_id" uuid,
	"to_phase_id" uuid NOT NULL,
	"conditions" jsonb,
	"required_column_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "phase_transition_rules_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"pipe_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "phase_kind" DEFAULT 'intermediate' NOT NULL,
	"required_column_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"form_id" uuid,
	"wip_limit" integer,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "phases_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "phases_wip_limit" CHECK ("phases"."wip_limit" is null or "phases"."wip_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "pipes" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pipes_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sla_events" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"sla_id" uuid NOT NULL,
	"tracker_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"type" "sla_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"elapsed_minutes" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "sla_events_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sla_trackers" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"sla_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status" "sla_tracker_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"warning_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_minutes" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "sla_trackers_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "slas" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"pipe_id" uuid,
	"phase_id" uuid,
	"name" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"warning_percent" smallint DEFAULT 80 NOT NULL,
	"use_business_time" boolean DEFAULT true NOT NULL,
	"work_calendar_id" uuid,
	"start_condition" jsonb,
	"stop_condition" jsonb,
	"pause_condition" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "slas_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "slas_target" CHECK ("slas"."target_minutes" > 0),
	CONSTRAINT "slas_warning" CHECK ("slas"."warning_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"type" "absence_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"hours_per_day" numeric(4, 2),
	"status" "approval_status" DEFAULT 'submitted' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "absences_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "absences_dates" CHECK ("absences"."end_date" >= "absences"."start_date")
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"item_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"hours_per_day" numeric(4, 2) NOT NULL,
	"status" "allocation_status" DEFAULT 'confirmed' NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "allocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "allocations_dates" CHECK ("allocations"."end_date" >= "allocations"."start_date"),
	CONSTRAINT "allocations_hours" CHECK ("allocations"."hours_per_day" > 0 and "allocations"."hours_per_day" <= 24)
);
--> statement-breakpoint
CREATE TABLE "resource_profiles" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"job_title" text,
	"department" text,
	"manager_id" uuid,
	"capacity_hours_per_week" numeric(5, 2) DEFAULT '40' NOT NULL,
	"cost_rate_hour" numeric(18, 4),
	"bill_rate_hour" numeric(18, 4),
	"work_calendar_id" uuid,
	"location" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resource_profiles_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "resource_profiles_capacity" CHECK ("resource_profiles"."capacity_hours_per_week" between 0 and 168)
);
--> statement-breakpoint
CREATE TABLE "resource_requests" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"item_id" uuid,
	"skill_id" uuid,
	"role_title" text NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "resource_request_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"notes" text,
	CONSTRAINT "resource_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "resource_requests_dates" CHECK ("resource_requests"."end_date" >= "resource_requests"."start_date"),
	CONSTRAINT "resource_requests_hours" CHECK ("resource_requests"."hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"category" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "skills_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"description" text,
	"is_billable" boolean DEFAULT true NOT NULL,
	"source" time_entry_source DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"status" "approval_status" DEFAULT 'draft' NOT NULL,
	"approval_id" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "time_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "time_entries_minutes" CHECK ("time_entries"."minutes" > 0 and "time_entries"."minutes" <= 1440),
	CONSTRAINT "time_entries_interval" CHECK ("time_entries"."ended_at" is null or "time_entries"."started_at" is null or "time_entries"."ended_at" > "time_entries"."started_at")
);
--> statement-breakpoint
CREATE TABLE "timesheet_approvals" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "approval_status" DEFAULT 'draft' NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "timesheet_approvals_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "timesheet_approvals_dates" CHECK ("timesheet_approvals"."period_end" >= "timesheet_approvals"."period_start")
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	CONSTRAINT "user_skills_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "user_skills_level" CHECK ("user_skills"."level" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"portfolio_id" uuid,
	"program_id" uuid,
	"kind" "board_kind" DEFAULT 'board' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "board_visibility" DEFAULT 'main' NOT NULL,
	"owner_id" uuid,
	"terminology" jsonb DEFAULT '{"singular":"item","plural":"itens"}'::jsonb NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"work_calendar_id" uuid,
	"contract_id" uuid,
	"seq" bigint DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"source_template_id" uuid,
	"position" text COLLATE "C" NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "boards_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "boards_dates" CHECK ("boards"."end_date" is null or "boards"."start_date" is null or "boards"."end_date" >= "boards"."start_date")
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"checklist_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"assignee_id" uuid,
	"due_date" date,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "checklist_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "checklist_items_done_consistency" CHECK (("checklist_items"."is_done" and "checklist_items"."done_at" is not null) or (not "checklist_items"."is_done"))
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "checklists_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"entity_type" "favorite_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	CONSTRAINT "favorites_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"color" text,
	"kind" "folder_kind" DEFAULT 'regular' NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "folders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "folders_not_own_parent" CHECK ("folders"."parent_id" is null or "folders"."parent_id" <> "folders"."id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#579bfc' NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"is_collapsed" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "groups_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "groups_tenant_board_id_key" UNIQUE("tenant_id","board_id","id")
);
--> statement-breakpoint
CREATE TABLE "id_sequences" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"scope" text NOT NULL,
	"period_key" text DEFAULT '' NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "id_sequences_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "id_sequences_non_negative" CHECK ("id_sequences"."current_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "item_field_index" (
	"tenant_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"column_key" text NOT NULL,
	"v_num" numeric,
	"v_date" date,
	"v_date_end" date,
	"v_text" text,
	"v_bool" boolean,
	CONSTRAINT "item_field_index_pkey" PRIMARY KEY("item_id","column_key")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"parent_item_id" uuid,
	"name" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"description" jsonb,
	"description_text" text,
	"sprint_id" uuid,
	"phase_id" uuid,
	"phase_entered_at" timestamp with time zone,
	"planned_start_date" date,
	"planned_end_date" date,
	"replanned_start_date" date,
	"replanned_end_date" date,
	"actual_start_date" date,
	"actual_end_date" date,
	"progress" numeric(5, 2),
	"estimate_hours" numeric(10, 2),
	"is_milestone" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "items_tenant_board_id_key" UNIQUE("tenant_id","board_id","id"),
	CONSTRAINT "items_not_own_parent" CHECK ("items"."parent_item_id" is null or "items"."parent_item_id" <> "items"."id"),
	CONSTRAINT "items_progress_range" CHECK ("items"."progress" is null or "items"."progress" between 0 and 100),
	CONSTRAINT "items_planned_dates" CHECK ("items"."planned_end_date" is null or "items"."planned_start_date" is null or "items"."planned_end_date" >= "items"."planned_start_date"),
	CONSTRAINT "items_replanned_dates" CHECK ("items"."replanned_end_date" is null or "items"."replanned_start_date" is null or "items"."replanned_end_date" >= "items"."replanned_start_date"),
	CONSTRAINT "items_actual_dates" CHECK ("items"."actual_end_date" is null or "items"."actual_start_date" is null or "items"."actual_end_date" >= "items"."actual_start_date")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"visibility" "workspace_visibility" DEFAULT 'open' NOT NULL,
	"enabled_modules" text[] DEFAULT '{core}'::text[] NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "saved_filters_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"resource_type" "share_resource" NOT NULL,
	"resource_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "share_links_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "share_links_token_hash_len" CHECK (char_length("share_links"."token_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"board_id" uuid NOT NULL,
	"owner_id" uuid,
	"type" "view_type" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filters" jsonb,
	"sort" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_by" jsonb,
	"hidden_column_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "views_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fk" FOREIGN KEY ("tenant_id","automation_id") REFERENCES "public"."automations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fk" FOREIGN KEY ("tenant_id","webhook_id") REFERENCES "public"."webhooks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_id_fk" FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "public"."attachments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_update_id_fk" FOREIGN KEY ("tenant_id","update_id") REFERENCES "public"."updates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_reply_id_fk" FOREIGN KEY ("tenant_id","reply_id") REFERENCES "public"."replies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_update_id_fk" FOREIGN KEY ("tenant_id","update_id") REFERENCES "public"."updates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_definitions" ADD CONSTRAINT "column_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_definitions" ADD CONSTRAINT "column_definitions_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropdown_options" ADD CONSTRAINT "dropdown_options_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropdown_options" ADD CONSTRAINT "dropdown_options_column_id_fk" FOREIGN KEY ("tenant_id","column_id") REFERENCES "public"."column_definitions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_labels" ADD CONSTRAINT "status_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_labels" ADD CONSTRAINT "status_labels_column_id_fk" FOREIGN KEY ("tenant_id","column_id") REFERENCES "public"."column_definitions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_measurement_id_fk" FOREIGN KEY ("tenant_id","measurement_id") REFERENCES "public"."measurements"("tenant_id","id") ON DELETE set null ("measurement_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_contract_id_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_service_order_id_fk" FOREIGN KEY ("tenant_id","service_order_id") REFERENCES "public"."service_orders"("tenant_id","id") ON DELETE set null ("service_order_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_contract_id_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_service_order_id_fk" FOREIGN KEY ("tenant_id","service_order_id") REFERENCES "public"."service_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_catalog_item_id_fk" FOREIGN KEY ("tenant_id","catalog_item_id") REFERENCES "public"."service_catalog_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_contract_id_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE set null ("board_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_dashboard_id_fk" FOREIGN KEY ("tenant_id","dashboard_id") REFERENCES "public"."dashboards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_target_group_id_fk" FOREIGN KEY ("tenant_id","target_group_id") REFERENCES "public"."groups"("tenant_id","id") ON DELETE set null ("target_group_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_role_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_resource_role_id_fk" FOREIGN KEY ("tenant_id","resource_role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE set null ("resource_role_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_snapshots" ADD CONSTRAINT "baseline_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_snapshots" ADD CONSTRAINT "baseline_snapshots_baseline_id_fk" FOREIGN KEY ("tenant_id","baseline_id") REFERENCES "public"."baselines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_snapshots" ADD CONSTRAINT "baseline_snapshots_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_predecessor_id_fk" FOREIGN KEY ("tenant_id","predecessor_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_successor_id_fk" FOREIGN KEY ("tenant_id","successor_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_fk" FOREIGN KEY ("tenant_id","calendar_id") REFERENCES "public"."work_calendars"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_program_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_portfolio_id_fk" FOREIGN KEY ("tenant_id","portfolio_id") REFERENCES "public"."portfolios"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_budget_id_fk" FOREIGN KEY ("tenant_id","budget_id") REFERENCES "public"."budgets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE set null ("board_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_risk_id_fk" FOREIGN KEY ("tenant_id","risk_id") REFERENCES "public"."risks"("tenant_id","id") ON DELETE set null ("risk_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_folder_id_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."folders"("tenant_id","id") ON DELETE set null ("folder_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_scoring_model_id_fk" FOREIGN KEY ("tenant_id","scoring_model_id") REFERENCES "public"."scoring_models"("tenant_id","id") ON DELETE set null ("scoring_model_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_portfolio_id_fk" FOREIGN KEY ("tenant_id","portfolio_id") REFERENCES "public"."portfolios"("tenant_id","id") ON DELETE set null ("portfolio_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health" ADD CONSTRAINT "project_health_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health" ADD CONSTRAINT "project_health_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health" ADD CONSTRAINT "project_health_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_scored_by_users_id_fk" FOREIGN KEY ("scored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_scoring_model_id_fk" FOREIGN KEY ("tenant_id","scoring_model_id") REFERENCES "public"."scoring_models"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_gates" ADD CONSTRAINT "stage_gates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_gates" ADD CONSTRAINT "stage_gates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_gates" ADD CONSTRAINT "stage_gates_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_transition_rules" ADD CONSTRAINT "phase_transition_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_transition_rules" ADD CONSTRAINT "phase_transition_rules_pipe_id_fk" FOREIGN KEY ("tenant_id","pipe_id") REFERENCES "public"."pipes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_transition_rules" ADD CONSTRAINT "phase_transition_rules_from_phase_id_fk" FOREIGN KEY ("tenant_id","from_phase_id") REFERENCES "public"."phases"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_transition_rules" ADD CONSTRAINT "phase_transition_rules_to_phase_id_fk" FOREIGN KEY ("tenant_id","to_phase_id") REFERENCES "public"."phases"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_pipe_id_fk" FOREIGN KEY ("tenant_id","pipe_id") REFERENCES "public"."pipes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_group_id_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_form_id_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE set null ("form_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipes" ADD CONSTRAINT "pipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipes" ADD CONSTRAINT "pipes_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_sla_id_fk" FOREIGN KEY ("tenant_id","sla_id") REFERENCES "public"."slas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_tracker_id_fk" FOREIGN KEY ("tenant_id","tracker_id") REFERENCES "public"."sla_trackers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_trackers" ADD CONSTRAINT "sla_trackers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_trackers" ADD CONSTRAINT "sla_trackers_sla_id_fk" FOREIGN KEY ("tenant_id","sla_id") REFERENCES "public"."slas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_trackers" ADD CONSTRAINT "sla_trackers_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slas" ADD CONSTRAINT "slas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slas" ADD CONSTRAINT "slas_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slas" ADD CONSTRAINT "slas_pipe_id_fk" FOREIGN KEY ("tenant_id","pipe_id") REFERENCES "public"."pipes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slas" ADD CONSTRAINT "slas_phase_id_fk" FOREIGN KEY ("tenant_id","phase_id") REFERENCES "public"."phases"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slas" ADD CONSTRAINT "slas_work_calendar_id_fk" FOREIGN KEY ("tenant_id","work_calendar_id") REFERENCES "public"."work_calendars"("tenant_id","id") ON DELETE set null ("work_calendar_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profiles" ADD CONSTRAINT "resource_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profiles" ADD CONSTRAINT "resource_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profiles" ADD CONSTRAINT "resource_profiles_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_profiles" ADD CONSTRAINT "resource_profiles_work_calendar_id_fk" FOREIGN KEY ("tenant_id","work_calendar_id") REFERENCES "public"."work_calendars"("tenant_id","id") ON DELETE set null ("work_calendar_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE set null ("item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_skill_id_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "public"."skills"("tenant_id","id") ON DELETE set null ("skill_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approval_id_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."timesheet_approvals"("tenant_id","id") ON DELETE set null ("approval_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_approvals" ADD CONSTRAINT "timesheet_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_approvals" ADD CONSTRAINT "timesheet_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_approvals" ADD CONSTRAINT "timesheet_approvals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skill_id_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "public"."skills"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_folder_id_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."folders"("tenant_id","id") ON DELETE set null ("folder_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_portfolio_id_fk" FOREIGN KEY ("tenant_id","portfolio_id") REFERENCES "public"."portfolios"("tenant_id","id") ON DELETE set null ("portfolio_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_program_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE set null ("program_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_work_calendar_id_fk" FOREIGN KEY ("tenant_id","work_calendar_id") REFERENCES "public"."work_calendars"("tenant_id","id") ON DELETE set null ("work_calendar_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_contract_id_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE set null ("contract_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fk" FOREIGN KEY ("tenant_id","checklist_id") REFERENCES "public"."checklists"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."folders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_sequences" ADD CONSTRAINT "id_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_field_index" ADD CONSTRAINT "item_field_index_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_field_index" ADD CONSTRAINT "item_field_index_item_fk" FOREIGN KEY ("tenant_id","board_id","item_id") REFERENCES "public"."items"("tenant_id","board_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_group_id_fk" FOREIGN KEY ("tenant_id","board_id","group_id") REFERENCES "public"."groups"("tenant_id","board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_item_id_fk" FOREIGN KEY ("tenant_id","board_id","parent_item_id") REFERENCES "public"."items"("tenant_id","board_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sprint_id_fk" FOREIGN KEY ("tenant_id","sprint_id") REFERENCES "public"."sprints"("tenant_id","id") ON DELETE set null ("sprint_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_phase_id_fk" FOREIGN KEY ("tenant_id","phase_id") REFERENCES "public"."phases"("tenant_id","id") ON DELETE set null ("phase_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_board_id_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_created_idx" ON "automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_dedupe_key" ON "automation_runs" USING btree ("automation_id","trigger_event_id","item_id") WHERE "automation_runs"."trigger_event_id" is not null;--> statement-breakpoint
CREATE INDEX "automations_board_enabled_idx" ON "automations" USING btree ("board_id") WHERE "automations"."is_enabled" and "automations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "automations_trigger_type_idx" ON "automations" USING btree ("tenant_id",("trigger" ->> 'type'));--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_webhook_event_key" ON "webhook_deliveries" USING btree ("webhook_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("next_retry_at") WHERE "webhook_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "activity_logs_item_created_idx" ON "activity_logs" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_board_created_idx" ON "activity_logs" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_versions_attachment_version_key" ON "attachment_versions" USING btree ("attachment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_versions_storage_key_key" ON "attachment_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_item_idx" ON "attachments" USING btree ("item_id") WHERE "attachments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "attachments_board_idx" ON "attachments" USING btree ("board_id") WHERE "attachments"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "follows_user_entity_key" ON "follows" USING btree ("tenant_id","user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "follows_entity_idx" ON "follows" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "mentions_target_idx" ON "mentions" USING btree ("tenant_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "mentions_source_idx" ON "mentions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_key" ON "notification_preferences" USING btree ("tenant_id","user_id","channel","event_type");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at") WHERE "notifications"."read_at" is null and "notifications"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_target_user_emoji_key" ON "reactions" USING btree ("target_type","target_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "replies_update_created_idx" ON "replies" USING btree ("update_id","created_at") WHERE "replies"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "updates_item_created_idx" ON "updates" USING btree ("item_id","created_at") WHERE "updates"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "updates_board_created_idx" ON "updates" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "column_definitions_board_key_key" ON "column_definitions" USING btree ("board_id","key");--> statement-breakpoint
CREATE INDEX "column_definitions_board_position_idx" ON "column_definitions" USING btree ("board_id","position") WHERE "column_definitions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "dropdown_options_column_label_key" ON "dropdown_options" USING btree ("column_id",lower("label")) WHERE "dropdown_options"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "dropdown_options_column_position_idx" ON "dropdown_options" USING btree ("column_id","position") WHERE "dropdown_options"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "status_labels_column_position_idx" ON "status_labels" USING btree ("column_id","position") WHERE "status_labels"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_tenant_number_key" ON "contracts" USING btree ("tenant_id","number") WHERE "contracts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_contract_number_key" ON "invoices" USING btree ("contract_id","number");--> statement-breakpoint
CREATE INDEX "measurements_contract_period_idx" ON "measurements" USING btree ("contract_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "service_catalog_items_contract_code_key" ON "service_catalog_items" USING btree ("contract_id","code");--> statement-breakpoint
CREATE INDEX "service_order_items_order_idx" ON "service_order_items" USING btree ("service_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_orders_contract_number_key" ON "service_orders" USING btree ("contract_id","number") WHERE "service_orders"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_orders_item_key" ON "service_orders" USING btree ("item_id") WHERE "service_orders"."item_id" is not null and "service_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "service_orders_contract_status_idx" ON "service_orders" USING btree ("contract_id","status");--> statement-breakpoint
CREATE INDEX "dashboards_workspace_position_idx" ON "dashboards" USING btree ("workspace_id","position") WHERE "dashboards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "widgets_dashboard_idx" ON "widgets" USING btree ("dashboard_id") WHERE "widgets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "form_fields_form_position_idx" ON "form_fields" USING btree ("form_id","position") WHERE "form_fields"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "form_submissions_form_created_idx" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_public_token_hash_key" ON "forms" USING btree ("public_token_hash") WHERE "forms"."public_token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "data_retention_policies_entity_key" ON "data_retention_policies" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE INDEX "templates_tenant_kind_idx" ON "templates" USING btree ("tenant_id","kind") WHERE "templates"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_resource_principal_key" ON "access_grants" USING btree ("tenant_id","resource_type","resource_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "access_grants_principal_idx" ON "access_grants" USING btree ("tenant_id","principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_email_idx" ON "invitations" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_key" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_key" ON "role_permissions" USING btree ("role_id","permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_key" ON "roles" USING btree ("tenant_id","scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("tenant_id","user_id") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_key" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_tenant_name_key" ON "teams" USING btree ("tenant_id","name") WHERE "teams"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_subject_key" ON "users" USING btree ("identity_provider","external_subject") WHERE "users"."external_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "baseline_snapshots_baseline_item_key" ON "baseline_snapshots" USING btree ("baseline_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "baselines_board_primary_key" ON "baselines" USING btree ("board_id") WHERE "baselines"."is_primary" and "baselines"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "dependencies_pair_key" ON "dependencies" USING btree ("predecessor_id","successor_id");--> statement-breakpoint
CREATE INDEX "dependencies_successor_idx" ON "dependencies" USING btree ("successor_id");--> statement-breakpoint
CREATE INDEX "dependencies_board_idx" ON "dependencies" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("date","scope");--> statement-breakpoint
CREATE INDEX "holidays_tenant_date_idx" ON "holidays" USING btree ("tenant_id","date") WHERE "holidays"."tenant_id" is not null;--> statement-breakpoint
CREATE INDEX "milestones_board_due_idx" ON "milestones" USING btree ("board_id","due_date") WHERE "milestones"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_board_active_key" ON "sprints" USING btree ("board_id") WHERE "sprints"."state" = 'active' and "sprints"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendars_tenant_default_key" ON "work_calendars" USING btree ("tenant_id") WHERE "work_calendars"."is_default" and "work_calendars"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cost_entries_budget_date_idx" ON "cost_entries" USING btree ("budget_id","entry_date") WHERE "cost_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "issues_board_status_idx" ON "issues" USING btree ("board_id","status") WHERE "issues"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "portfolios_workspace_idx" ON "portfolios" USING btree ("workspace_id") WHERE "portfolios"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "programs_portfolio_idx" ON "programs" USING btree ("portfolio_id") WHERE "programs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "project_health_board_reported_idx" ON "project_health" USING btree ("board_id","reported_at");--> statement-breakpoint
CREATE INDEX "risks_board_status_idx" ON "risks" USING btree ("board_id","status") WHERE "risks"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "scores_model_board_key" ON "scores" USING btree ("scoring_model_id","board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_models_tenant_default_key" ON "scoring_models" USING btree ("tenant_id") WHERE "scoring_models"."is_default" and "scoring_models"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "stage_gates_board_position_idx" ON "stage_gates" USING btree ("board_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "phase_transition_rules_pair_key" ON "phase_transition_rules" USING btree ("pipe_id","from_phase_id","to_phase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phases_group_key" ON "phases" USING btree ("group_id") WHERE "phases"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "phases_pipe_position_idx" ON "phases" USING btree ("pipe_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipes_board_key" ON "pipes" USING btree ("board_id") WHERE "pipes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sla_events_item_idx" ON "sla_events" USING btree ("item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_trackers_sla_item_running_key" ON "sla_trackers" USING btree ("sla_id","item_id") WHERE "sla_trackers"."status" in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "sla_trackers_due_idx" ON "sla_trackers" USING btree ("due_at") WHERE "sla_trackers"."status" = 'running';--> statement-breakpoint
CREATE INDEX "absences_user_period_idx" ON "absences" USING btree ("tenant_id","user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "allocations_user_period_idx" ON "allocations" USING btree ("tenant_id","user_id","start_date","end_date") WHERE "allocations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "allocations_board_idx" ON "allocations" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_profiles_tenant_user_key" ON "resource_profiles" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "resource_requests_status_idx" ON "resource_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_tenant_name_key" ON "skills" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "time_entries_user_date_idx" ON "time_entries" USING btree ("tenant_id","user_id","entry_date") WHERE "time_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "time_entries_item_idx" ON "time_entries" USING btree ("item_id") WHERE "time_entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_approvals_user_period_key" ON "timesheet_approvals" USING btree ("tenant_id","user_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "user_skills_user_skill_key" ON "user_skills" USING btree ("tenant_id","user_id","skill_id");--> statement-breakpoint
CREATE INDEX "boards_workspace_folder_position_idx" ON "boards" USING btree ("workspace_id","folder_id","position") WHERE "boards"."deleted_at" is null and "boards"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "boards_program_idx" ON "boards" USING btree ("program_id") WHERE "boards"."program_id" is not null;--> statement-breakpoint
CREATE INDEX "boards_portfolio_idx" ON "boards" USING btree ("portfolio_id") WHERE "boards"."portfolio_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_checklist_position_idx" ON "checklist_items" USING btree ("checklist_id","position") WHERE "checklist_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "checklists_item_position_idx" ON "checklists" USING btree ("item_id","position") WHERE "checklists"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_entity_key" ON "favorites" USING btree ("tenant_id","user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "folders_workspace_parent_position_idx" ON "folders" USING btree ("workspace_id","parent_id","position") WHERE "folders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "groups_board_position_idx" ON "groups" USING btree ("board_id","position") WHERE "groups"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "id_sequences_scope_period_key" ON "id_sequences" USING btree ("tenant_id","scope","period_key");--> statement-breakpoint
CREATE INDEX "item_field_index_num_idx" ON "item_field_index" USING btree ("board_id","column_key","v_num","item_id") WHERE "item_field_index"."v_num" is not null;--> statement-breakpoint
CREATE INDEX "item_field_index_date_idx" ON "item_field_index" USING btree ("board_id","column_key","v_date","item_id") WHERE "item_field_index"."v_date" is not null;--> statement-breakpoint
CREATE INDEX "item_field_index_text_idx" ON "item_field_index" USING btree ("board_id","column_key","v_text","item_id") WHERE "item_field_index"."v_text" is not null;--> statement-breakpoint
CREATE INDEX "item_field_index_bool_idx" ON "item_field_index" USING btree ("board_id","column_key","v_bool") WHERE "item_field_index"."v_bool" is not null;--> statement-breakpoint
CREATE INDEX "items_board_group_position_idx" ON "items" USING btree ("board_id","group_id","position") WHERE "items"."archived_at" is null and "items"."deleted_at" is null and "items"."parent_item_id" is null;--> statement-breakpoint
CREATE INDEX "items_parent_position_idx" ON "items" USING btree ("parent_item_id","position") WHERE "items"."parent_item_id" is not null and "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_board_archived_idx" ON "items" USING btree ("board_id","archived_at") WHERE "items"."archived_at" is not null and "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_board_updated_idx" ON "items" USING btree ("board_id","updated_at");--> statement-breakpoint
CREATE INDEX "items_board_planned_end_idx" ON "items" USING btree ("board_id","planned_end_date") WHERE "items"."deleted_at" is null and "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "items_sprint_idx" ON "items" USING btree ("sprint_id") WHERE "items"."sprint_id" is not null;--> statement-breakpoint
CREATE INDEX "items_values_gin_idx" ON "items" USING gin ("values" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "items_name_trgm_idx" ON "items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "workspaces_tenant_position_idx" ON "workspaces" USING btree ("tenant_id","position") WHERE "workspaces"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "saved_filters_board_idx" ON "saved_filters" USING btree ("board_id") WHERE "saved_filters"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_resource_idx" ON "share_links" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "views_board_position_idx" ON "views" USING btree ("board_id","position") WHERE "views"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "views_board_default_key" ON "views" USING btree ("board_id") WHERE "views"."is_default" and "views"."owner_id" is null and "views"."deleted_at" is null;