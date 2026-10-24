ALTER TABLE "index_commits" DROP CONSTRAINT "index_commits_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_days" DROP CONSTRAINT "index_days_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_file_paths" DROP CONSTRAINT "index_file_paths_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_files" DROP CONSTRAINT "index_files_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_folder_days" DROP CONSTRAINT "index_folder_days_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_folders" DROP CONSTRAINT "index_folders_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_head_files" DROP CONSTRAINT "index_head_files_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_people" DROP CONSTRAINT "index_people_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_persons" DROP CONSTRAINT "index_persons_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_signature_days" DROP CONSTRAINT "index_signature_days_si_stored_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "index_signature_folder_days" DROP CONSTRAINT "index_signature_folder_days_si_stored_indexes_id_fk";
--> statement-breakpoint
DROP INDEX "index_files_path";--> statement-breakpoint
DROP INDEX "pull_requests_author";--> statement-breakpoint
DROP INDEX "pull_reviews_reviewer";--> statement-breakpoint
DROP INDEX "repo_people_login";--> statement-breakpoint
ALTER TABLE "index_commits" ADD COLUMN "arrival" bigint;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "closed_at" bigint;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merged_by" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "base_ref" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "draft" boolean;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "changed_files" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "commits" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "head_owner" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "from_fork" boolean;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "labels" jsonb;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "review_decision" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merge_commit" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "comments" integer;--> statement-breakpoint
ALTER TABLE "pull_reviews" ADD COLUMN "last_at" bigint;--> statement-breakpoint
ALTER TABLE "pull_reviews" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "pull_reviews" ADD COLUMN "approved_at" bigint;--> statement-breakpoint
ALTER TABLE "repo_branches" ADD COLUMN "bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "pulls_cursor" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "pulls_mark" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "pulls_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "repo_people_lower_login" ON "repo_people" USING btree (lower("login"));