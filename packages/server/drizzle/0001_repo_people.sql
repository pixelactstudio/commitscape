CREATE TABLE "repo_people" (
	"repo_id" text NOT NULL,
	"person_id" integer NOT NULL,
	"name" text NOT NULL,
	"login" text,
	"commits" integer NOT NULL,
	"lines_added" integer,
	"lines_removed" integer,
	"first" bigint,
	"last" bigint,
	"report_key" text NOT NULL,
	CONSTRAINT "repo_people_repo_id_person_id_pk" PRIMARY KEY("repo_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "repo_people" ADD CONSTRAINT "repo_people_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_people_login" ON "repo_people" USING btree ("login");