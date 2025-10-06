CREATE TYPE "public"."processing_stage" AS ENUM('import', 'encode', 'metadata', 'geolocation', 'variants', 'ffmpeg');--> statement-breakpoint
CREATE TABLE "processing_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"stage" "processing_stage" NOT NULL,
	"message" text NOT NULL,
	"extra" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_issue" ADD CONSTRAINT "processing_issue_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;