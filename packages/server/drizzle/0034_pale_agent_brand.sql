CREATE TABLE "index_commit_lines" (
	"si" integer NOT NULL,
	"sha" "bytea" NOT NULL,
	"added" integer NOT NULL,
	"removed" integer NOT NULL,
	CONSTRAINT "index_commit_lines_si_sha_pk" PRIMARY KEY("si","sha")
);
