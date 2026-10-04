CREATE TABLE "crew_members" (
	"crew_id" text NOT NULL,
	"login" text NOT NULL,
	"user_id" text,
	"state" text NOT NULL,
	"invited_by" text NOT NULL,
	"invited_at" bigint NOT NULL,
	"answered_at" bigint,
	CONSTRAINT "crew_members_crew_id_login_pk" PRIMARY KEY("crew_id","login")
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_members" (
	"race_id" text NOT NULL,
	"login" text NOT NULL,
	"user_id" text,
	"state" text NOT NULL,
	"invited_by" text NOT NULL,
	"invited_at" bigint NOT NULL,
	"answered_at" bigint,
	CONSTRAINT "race_members_race_id_login_pk" PRIMARY KEY("race_id","login")
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"created_at" bigint NOT NULL,
	"standings" text,
	"standings_at" bigint
);
--> statement-breakpoint
CREATE TABLE "season_standings" (
	"crew_id" text NOT NULL,
	"season" text NOT NULL,
	"data" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "season_standings_crew_id_season_pk" PRIMARY KEY("crew_id","season")
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_members" ADD CONSTRAINT "race_members_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_members" ADD CONSTRAINT "race_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_members_login" ON "crew_members" USING btree ("login");--> statement-breakpoint
CREATE INDEX "race_members_login" ON "race_members" USING btree ("login");