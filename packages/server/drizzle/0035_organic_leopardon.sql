CREATE OR REPLACE FUNCTION "stored_index_deleted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "index_commits" WHERE "si" = OLD."id";
  DELETE FROM "index_commit_lines" WHERE "si" = OLD."id";
  DELETE FROM "index_files" WHERE "si" = OLD."id";
  DELETE FROM "index_file_paths" WHERE "si" = OLD."id";
  DELETE FROM "index_folders" WHERE "si" = OLD."id";
  DELETE FROM "index_persons" WHERE "si" = OLD."id";
  DELETE FROM "index_people" WHERE "si" = OLD."id";
  DELETE FROM "index_head_files" WHERE "si" = OLD."id";
  RETURN OLD;
END $$;--> statement-breakpoint
INSERT INTO "index_commit_lines" ("si", "sha", "added", "removed")
SELECT "si", "sha", coalesce((SELECT sum(x) FROM unnest("added") AS x), 0), coalesce((SELECT sum(x) FROM unnest("removed") AS x), 0)
FROM "index_commits" WHERE "added" IS NOT NULL
ON CONFLICT DO NOTHING;
