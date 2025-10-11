ALTER TABLE "image_metadata"
  ADD COLUMN "camera_make" text,
  ADD COLUMN "camera_model" text,
  ADD COLUMN "lens_model" text,
  ADD COLUMN "iso" integer,
  ADD COLUMN "exposure_time" text,
  ADD COLUMN "focal_length" integer,
  ADD COLUMN "f_number" text;

