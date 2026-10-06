CREATE TABLE "rivals" (
	"user_id" text NOT NULL,
	"rival" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "rivals_user_id_rival_pk" PRIMARY KEY("user_id","rival")
);
--> statement-breakpoint
ALTER TABLE "rivals" ADD CONSTRAINT "rivals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;