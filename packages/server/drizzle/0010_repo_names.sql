CREATE TABLE "repo_names" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_names" ADD CONSTRAINT "repo_names_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_names_repo" ON "repo_names" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "repositories_github_id" ON "repositories" USING btree ("github_id");