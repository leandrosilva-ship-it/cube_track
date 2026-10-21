CREATE TYPE "public"."collab_source" AS ENUM('app', 'email');--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "source" "collab_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "edit_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "updates" ADD COLUMN "source" "collab_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "updates" ADD COLUMN "edit_history" jsonb DEFAULT '[]'::jsonb NOT NULL;