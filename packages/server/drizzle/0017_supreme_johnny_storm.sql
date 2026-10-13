DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gin;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gin') THEN
    CREATE INDEX IF NOT EXISTS "index_commits_files" ON "index_commits" USING gin ("si", "files");
  ELSE
    CREATE INDEX IF NOT EXISTS "index_commits_files" ON "index_commits" USING gin ("files");
  END IF;
END $$;
