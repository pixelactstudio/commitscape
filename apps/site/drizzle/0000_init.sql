CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`facts` text,
	`facts_at` integer,
	`report_key` text,
	`report_at` integer,
	`report_bytes` integer,
	`viewed_at` integer
);
