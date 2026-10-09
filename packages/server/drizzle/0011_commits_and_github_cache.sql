CREATE TABLE "commits" (
	"repo_id" text NOT NULL,
	"report_key" text NOT NULL,
	"seq" integer NOT NULL,
	"sha" text NOT NULL,
	"at" bigint NOT NULL,
	"offset" smallint NOT NULL,
	"person_id" integer NOT NULL,
	"subject" text NOT NULL,
	"kind" smallint NOT NULL,
	"merge" boolean NOT NULL,
	"files" integer NOT NULL,
	"added" integer,
	"removed" integer,
	CONSTRAINT "commits_repo_id_report_key_seq_pk" PRIMARY KEY("repo_id","report_key","seq")
);
--> statement-breakpoint
CREATE TABLE "github_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"etag" text,
	"status" integer NOT NULL,
	"body" text,
	"fetched_at" bigint NOT NULL,
	"until" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commits_person" ON "commits" USING btree ("repo_id","report_key","person_id","seq");--> statement-breakpoint
CREATE INDEX "commits_at" ON "commits" USING btree ("repo_id","report_key","at");--> statement-breakpoint
CREATE INDEX "github_cache_until" ON "github_cache" USING btree ("until");