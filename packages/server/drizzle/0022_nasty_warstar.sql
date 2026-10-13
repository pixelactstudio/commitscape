CREATE TABLE "index_persons" (
	"si" integer NOT NULL,
	"person" integer NOT NULL,
	"traits" smallint NOT NULL,
	"identities" integer NOT NULL,
	"commits" integer NOT NULL,
	CONSTRAINT "index_persons_si_person_pk" PRIMARY KEY("si","person")
);
--> statement-breakpoint
ALTER TABLE "index_files" ADD COLUMN "role" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "index_files" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "index_files" ADD COLUMN "guessed_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "index_files" ADD COLUMN "lockfile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stored_indexes" ADD COLUMN "anchor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stored_indexes" ADD COLUMN "options" jsonb DEFAULT '{"max_changeset_size":50,"coupling_support":5,"ownership_min_commits":10}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stored_indexes" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "index_persons" ADD CONSTRAINT "index_persons_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;