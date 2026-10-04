CREATE TABLE "people" (
	"login" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"name_private" boolean DEFAULT false NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"repo_id" text NOT NULL,
	"number" integer NOT NULL,
	"author" text,
	"state" text NOT NULL,
	"title" text NOT NULL,
	"created_at" bigint NOT NULL,
	"merged_at" bigint,
	"updated_at" bigint NOT NULL,
	"additions" integer NOT NULL,
	"deletions" integer NOT NULL,
	CONSTRAINT "pull_requests_repo_id_number_pk" PRIMARY KEY("repo_id","number")
);
--> statement-breakpoint
CREATE TABLE "pull_reviews" (
	"repo_id" text NOT NULL,
	"number" integer NOT NULL,
	"reviewer" text NOT NULL,
	"reviews" integer NOT NULL,
	"first_at" bigint NOT NULL,
	CONSTRAINT "pull_reviews_repo_id_number_reviewer_pk" PRIMARY KEY("repo_id","number","reviewer")
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "pulls_at" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "pulls_read_at" bigint;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_reviews" ADD CONSTRAINT "pull_reviews_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_user" ON "people" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pull_requests_author" ON "pull_requests" USING btree ("author","merged_at");--> statement-breakpoint
CREATE INDEX "pull_reviews_reviewer" ON "pull_reviews" USING btree ("reviewer","first_at");