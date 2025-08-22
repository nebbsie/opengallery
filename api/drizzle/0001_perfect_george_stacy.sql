CREATE TYPE "public"."user_type" AS ENUM('user', 'admin');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "type" "user_type" DEFAULT 'user' NOT NULL;