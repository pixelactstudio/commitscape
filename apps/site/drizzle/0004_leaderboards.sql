ALTER TABLE `repositories` ADD `seed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `language` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `stars` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `bus_factor` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `maintainers` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `commits_30d` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `people_30d` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `code_lines` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `untouched_5y` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `answered` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `answer_hours` real;