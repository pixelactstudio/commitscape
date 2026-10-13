ALTER TABLE "pull_requests" ADD COLUMN "head_ref" text;--> statement-breakpoint
CREATE INDEX "pull_requests_head" ON "pull_requests" USING btree ("repo_id","head_ref");