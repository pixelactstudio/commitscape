CREATE TABLE "repo_states" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"saved_at" bigint NOT NULL,
	"used_at" bigint NOT NULL,
	"bytes" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "repo_states_used" ON "repo_states" USING btree ("used_at");