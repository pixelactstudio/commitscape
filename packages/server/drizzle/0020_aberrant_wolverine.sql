ALTER TABLE "index_files" ADD COLUMN "folder" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "index_folder_days" ADD COLUMN "folder" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "index_folders" ADD COLUMN "id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "index_folders" ADD COLUMN "parent" integer;--> statement-breakpoint
ALTER TABLE "index_signature_folder_days" ADD COLUMN "folder" integer NOT NULL;--> statement-breakpoint
CREATE INDEX "index_files_folder" ON "index_files" USING btree ("si","folder");--> statement-breakpoint
CREATE INDEX "index_folders_parent" ON "index_folders" USING btree ("si","parent");