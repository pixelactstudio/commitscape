ALTER TABLE "repositories" ADD COLUMN "report_stats" jsonb;--> statement-breakpoint
ALTER TABLE "stored_indexes" ADD COLUMN "lines_left" integer;