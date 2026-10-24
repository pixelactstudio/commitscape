CREATE TABLE "repo_blobs" (
	"repo_id" text NOT NULL,
	"sha" text NOT NULL,
	"lines" integer NOT NULL,
	"binary" boolean NOT NULL,
	CONSTRAINT "repo_blobs_repo_id_sha_pk" PRIMARY KEY("repo_id","sha")
);
--> statement-breakpoint
CREATE TABLE "repo_branch_details" (
	"repo_id" text NOT NULL,
	"position" integer NOT NULL,
	"against" text NOT NULL,
	"commits" jsonb NOT NULL,
	"commits_total" integer NOT NULL,
	"files" jsonb NOT NULL,
	"files_total" integer NOT NULL,
	"added" integer NOT NULL,
	"removed" integer NOT NULL,
	CONSTRAINT "repo_branch_details_repo_id_position_pk" PRIMARY KEY("repo_id","position")
);
--> statement-breakpoint
CREATE TABLE "repo_branches" (
	"repo_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"sha" text NOT NULL,
	"at" bigint NOT NULL,
	"author" text NOT NULL,
	"login" text,
	"subject" text NOT NULL,
	"ahead" integer NOT NULL,
	"behind" integer NOT NULL,
	"base" text NOT NULL,
	"base_at" bigint NOT NULL,
	"merged" boolean NOT NULL,
	"squashed" boolean DEFAULT false NOT NULL,
	"parent" text,
	"shared" integer NOT NULL,
	CONSTRAINT "repo_branches_repo_id_position_pk" PRIMARY KEY("repo_id","position")
);
--> statement-breakpoint
CREATE TABLE "repo_tags" (
	"repo_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"sha" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "repo_tags_repo_id_position_pk" PRIMARY KEY("repo_id","position")
);
--> statement-breakpoint
ALTER TABLE "repo_git" ADD COLUMN "branches_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_git" ADD COLUMN "tags_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_git" ADD COLUMN "inferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_blobs" ADD CONSTRAINT "repo_blobs_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_branch_details" ADD CONSTRAINT "repo_branch_details_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_branches" ADD CONSTRAINT "repo_branches_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tags" ADD CONSTRAINT "repo_tags_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;