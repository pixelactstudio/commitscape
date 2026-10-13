CREATE TABLE "repo_events" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor" text,
	"title" text,
	"url" text,
	"count" integer,
	"at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_events" ADD CONSTRAINT "repo_events_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_events_repo_at" ON "repo_events" USING btree ("repo_id","at");