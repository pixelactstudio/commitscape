CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`delete_hash` text NOT NULL,
	`upload_hash` text,
	`uploaded` integer DEFAULT false NOT NULL
);
