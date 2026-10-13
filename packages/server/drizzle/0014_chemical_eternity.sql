CREATE TABLE "private_work" (
	"login" text NOT NULL,
	"repo" text NOT NULL,
	"show" text NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "private_work_login_repo_pk" PRIMARY KEY("login","repo")
);
