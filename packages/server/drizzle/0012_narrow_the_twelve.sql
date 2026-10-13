CREATE TABLE "lent_tokens" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"until" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lent_tokens" ADD CONSTRAINT "lent_tokens_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lent_tokens" ADD CONSTRAINT "lent_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;