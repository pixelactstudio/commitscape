CREATE TABLE "profiles" (
	"login" text NOT NULL,
	"scope" text NOT NULL,
	"github_id" bigint,
	"identity" text NOT NULL,
	"identity_at" bigint NOT NULL,
	"data" text,
	"raw" text,
	"fetched_at" bigint,
	CONSTRAINT "profiles_login_scope_pk" PRIMARY KEY("login","scope")
);
--> statement-breakpoint
CREATE INDEX "profiles_github_id" ON "profiles" USING btree ("github_id");