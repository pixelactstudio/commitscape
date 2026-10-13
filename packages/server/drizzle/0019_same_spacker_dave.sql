DROP INDEX "index_files_folder";--> statement-breakpoint
DROP INDEX "index_folders_parent";--> statement-breakpoint
DROP INDEX "index_files_path";--> statement-breakpoint
ALTER TABLE "index_folder_days" DROP CONSTRAINT "index_folder_days_si_folder_day_pk";--> statement-breakpoint
ALTER TABLE "index_folders" DROP CONSTRAINT "index_folders_si_path_pk";--> statement-breakpoint
ALTER TABLE "index_signature_folder_days" DROP CONSTRAINT "index_signature_folder_days_si_folder_day_signature_pk";--> statement-breakpoint
CREATE UNIQUE INDEX "index_folders_path" ON "index_folders" USING btree ("si","path");--> statement-breakpoint
CREATE INDEX "index_files_path" ON "index_files" USING hash ("path");--> statement-breakpoint
ALTER TABLE "index_files" DROP COLUMN "folder";--> statement-breakpoint
ALTER TABLE "index_folder_days" DROP COLUMN "folder";--> statement-breakpoint
ALTER TABLE "index_folders" DROP COLUMN "parent";--> statement-breakpoint
ALTER TABLE "index_signature_folder_days" DROP COLUMN "folder";