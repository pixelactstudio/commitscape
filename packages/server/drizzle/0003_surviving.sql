CREATE TABLE "surviving" (
	"repo_id" text NOT NULL,
	"report_key" text NOT NULL,
	"person_id" integer NOT NULL,
	"status" text NOT NULL,
	"lines" integer,
	"added" integer,
	"files" integer,
	"seconds" real,
	"head" text,
	"asked_at" bigint NOT NULL,
	"counted_at" bigint,
	CONSTRAINT "surviving_repo_id_report_key_person_id_pk" PRIMARY KEY("repo_id","report_key","person_id")
);
--> statement-breakpoint
ALTER TABLE "surviving" ADD CONSTRAINT "surviving_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "surviving_status" ON "surviving" USING btree ("status","asked_at");