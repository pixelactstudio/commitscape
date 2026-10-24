CREATE OR REPLACE FUNCTION "stored_index_deleted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "index_commits" WHERE "si" = OLD."id";
  DELETE FROM "index_files" WHERE "si" = OLD."id";
  DELETE FROM "index_file_paths" WHERE "si" = OLD."id";
  DELETE FROM "index_folders" WHERE "si" = OLD."id";
  DELETE FROM "index_persons" WHERE "si" = OLD."id";
  DELETE FROM "index_people" WHERE "si" = OLD."id";
  DELETE FROM "index_days" WHERE "si" = OLD."id";
  DELETE FROM "index_signature_days" WHERE "si" = OLD."id";
  DELETE FROM "index_folder_days" WHERE "si" = OLD."id";
  DELETE FROM "index_signature_folder_days" WHERE "si" = OLD."id";
  DELETE FROM "index_head_files" WHERE "si" = OLD."id";
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER "stored_indexes_deleted" AFTER DELETE ON "stored_indexes" FOR EACH ROW EXECUTE FUNCTION "stored_index_deleted"();
