CREATE TABLE "repo_git" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"build_id" text NOT NULL,
	"built_at" bigint NOT NULL,
	"head" text NOT NULL,
	"branch" text NOT NULL,
	"branches" integer DEFAULT 0 NOT NULL,
	"tags" integer DEFAULT 0 NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"stored" integer DEFAULT 0 NOT NULL,
	"pulls" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"logged" integer DEFAULT 0 NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"seconds" real DEFAULT 0 NOT NULL,
	"steps" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_git" ADD CONSTRAINT "repo_git_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;