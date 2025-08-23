CREATE TYPE "public"."file_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dir" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"type" "file_type" NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
