CREATE TABLE "proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"user_id" text NOT NULL,
	"data" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proofs_login" ON "proofs" USING btree ("login");