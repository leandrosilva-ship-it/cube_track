CREATE TABLE "item_reads" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_reads_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "column_definitions" ADD COLUMN "default_value" jsonb;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "item_reads" ADD CONSTRAINT "item_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_reads" ADD CONSTRAINT "item_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_reads" ADD CONSTRAINT "item_reads_item_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_reads_user_item_key" ON "item_reads" USING btree ("tenant_id","user_id","item_id");--> statement-breakpoint
CREATE INDEX "items_board_deleted_idx" ON "items" USING btree ("board_id","deleted_at") WHERE "items"."deleted_at" is not null;