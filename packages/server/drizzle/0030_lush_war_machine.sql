DROP TABLE "index_days" CASCADE;--> statement-breakpoint
DROP TABLE "index_folder_days" CASCADE;--> statement-breakpoint
DROP TABLE "index_signature_days" CASCADE;--> statement-breakpoint
DROP TABLE "index_signature_folder_days" CASCADE;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "report_meta" jsonb;--> statement-breakpoint
ALTER TABLE "stored_indexes" ADD COLUMN "pack" text;