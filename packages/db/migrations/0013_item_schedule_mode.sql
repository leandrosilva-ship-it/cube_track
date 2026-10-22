CREATE TYPE "public"."item_schedule_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "schedule_mode" "item_schedule_mode" DEFAULT 'auto' NOT NULL;