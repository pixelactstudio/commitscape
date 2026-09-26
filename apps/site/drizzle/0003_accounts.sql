CREATE TABLE `access` (
	`key` text PRIMARY KEY NOT NULL,
	`allowed` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`github_token` text NOT NULL,
	`github_token_expires_at` integer,
	`github_refresh` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `repositories` ADD `installation_id` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `connected_by` text;