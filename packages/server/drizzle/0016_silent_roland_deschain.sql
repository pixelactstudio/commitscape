CREATE TABLE "index_commits" (
	"si" integer NOT NULL,
	"sha" "bytea" NOT NULL,
	"at" bigint NOT NULL,
	"offset" smallint NOT NULL,
	"author_delta" integer NOT NULL,
	"signature" integer NOT NULL,
	"kind" smallint NOT NULL,
	"flags" smallint NOT NULL,
	"subject" text NOT NULL,
	"files" integer[] NOT NULL,
	"changes" smallint[] NOT NULL,
	"added" integer[],
	"removed" integer[],
	CONSTRAINT "index_commits_si_sha_pk" PRIMARY KEY("si","sha")
);
--> statement-breakpoint
CREATE TABLE "index_days" (
	"si" integer NOT NULL,
	"day" integer NOT NULL,
	"commits" integer NOT NULL,
	"merges" integer NOT NULL,
	"bulk" integer NOT NULL,
	"changes" integer NOT NULL,
	"added" bigint NOT NULL,
	"removed" bigint NOT NULL,
	CONSTRAINT "index_days_si_day_pk" PRIMARY KEY("si","day")
);
--> statement-breakpoint
CREATE TABLE "index_file_paths" (
	"si" integer NOT NULL,
	"file" integer NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "index_file_paths_si_file_path_pk" PRIMARY KEY("si","file","path")
);
--> statement-breakpoint
CREATE TABLE "index_files" (
	"si" integer NOT NULL,
	"file" integer NOT NULL,
	"path" text NOT NULL,
	"folder" text NOT NULL,
	"born" bigint NOT NULL,
	"last" bigint NOT NULL,
	"alive" boolean NOT NULL,
	CONSTRAINT "index_files_si_file_pk" PRIMARY KEY("si","file")
);
--> statement-breakpoint
CREATE TABLE "index_folder_days" (
	"si" integer NOT NULL,
	"day" integer NOT NULL,
	"folder" text NOT NULL,
	"commits" integer NOT NULL,
	"changes" integer NOT NULL,
	"added" bigint NOT NULL,
	"removed" bigint NOT NULL,
	CONSTRAINT "index_folder_days_si_folder_day_pk" PRIMARY KEY("si","folder","day")
);
--> statement-breakpoint
CREATE TABLE "index_folders" (
	"si" integer NOT NULL,
	"path" text NOT NULL,
	"parent" text,
	"depth" smallint NOT NULL,
	CONSTRAINT "index_folders_si_path_pk" PRIMARY KEY("si","path")
);
--> statement-breakpoint
CREATE TABLE "index_head_files" (
	"si" integer NOT NULL,
	"file" integer NOT NULL,
	"blob" "bytea" NOT NULL,
	"bytes" bigint NOT NULL,
	"lines" integer NOT NULL,
	"class" text NOT NULL,
	"indent_levels" integer NOT NULL,
	"indent_mean" real NOT NULL,
	"indent_stddev" real NOT NULL,
	CONSTRAINT "index_head_files_si_file_pk" PRIMARY KEY("si","file")
);
--> statement-breakpoint
CREATE TABLE "index_people" (
	"si" integer NOT NULL,
	"signature" integer NOT NULL,
	"name" text NOT NULL,
	"person" integer,
	"person_name" text,
	"colour" smallint,
	"login" text,
	"bot" boolean NOT NULL,
	CONSTRAINT "index_people_si_signature_pk" PRIMARY KEY("si","signature")
);
--> statement-breakpoint
CREATE TABLE "index_signature_days" (
	"si" integer NOT NULL,
	"day" integer NOT NULL,
	"signature" integer NOT NULL,
	"commits" integer NOT NULL,
	"merges" integer NOT NULL,
	"bulk" integer NOT NULL,
	"changes" integer NOT NULL,
	"added" bigint NOT NULL,
	"removed" bigint NOT NULL,
	CONSTRAINT "index_signature_days_si_day_signature_pk" PRIMARY KEY("si","day","signature")
);
--> statement-breakpoint
CREATE TABLE "index_signature_folder_days" (
	"si" integer NOT NULL,
	"day" integer NOT NULL,
	"signature" integer NOT NULL,
	"folder" text NOT NULL,
	"commits" integer NOT NULL,
	"changes" integer NOT NULL,
	"added" bigint NOT NULL,
	"removed" bigint NOT NULL,
	CONSTRAINT "index_signature_folder_days_si_folder_day_signature_pk" PRIMARY KEY("si","folder","day","signature")
);
--> statement-breakpoint
CREATE TABLE "stored_indexes" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"lineage" text NOT NULL,
	"kept" boolean NOT NULL,
	"state" text NOT NULL,
	"head" text,
	"frontier" text[] DEFAULT '{}' NOT NULL,
	"lines" boolean NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"built_at" bigint NOT NULL,
	"loaded_at" bigint
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "index_id" integer;--> statement-breakpoint
ALTER TABLE "index_commits" ADD CONSTRAINT "index_commits_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_days" ADD CONSTRAINT "index_days_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_file_paths" ADD CONSTRAINT "index_file_paths_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_files" ADD CONSTRAINT "index_files_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_folder_days" ADD CONSTRAINT "index_folder_days_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_folders" ADD CONSTRAINT "index_folders_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_head_files" ADD CONSTRAINT "index_head_files_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_people" ADD CONSTRAINT "index_people_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_signature_days" ADD CONSTRAINT "index_signature_days_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_signature_folder_days" ADD CONSTRAINT "index_signature_folder_days_si_stored_indexes_id_fk" FOREIGN KEY ("si") REFERENCES "public"."stored_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_indexes" ADD CONSTRAINT "stored_indexes_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_commits_at" ON "index_commits" USING btree ("si","at");--> statement-breakpoint
CREATE INDEX "index_commits_signature" ON "index_commits" USING btree ("si","signature","at");--> statement-breakpoint
CREATE INDEX "index_files_path" ON "index_files" USING btree ("si","path");--> statement-breakpoint
CREATE INDEX "index_files_folder" ON "index_files" USING btree ("si","folder");--> statement-breakpoint
CREATE INDEX "index_folder_days_day" ON "index_folder_days" USING btree ("si","day");--> statement-breakpoint
CREATE INDEX "index_folders_parent" ON "index_folders" USING btree ("si","parent");--> statement-breakpoint
CREATE INDEX "index_people_person" ON "index_people" USING btree ("si","person");--> statement-breakpoint
CREATE INDEX "index_signature_days_signature" ON "index_signature_days" USING btree ("si","signature","day");--> statement-breakpoint
CREATE INDEX "index_signature_folder_days_day" ON "index_signature_folder_days" USING btree ("si","day");--> statement-breakpoint
CREATE INDEX "stored_indexes_repo" ON "stored_indexes" USING btree ("repo_id");