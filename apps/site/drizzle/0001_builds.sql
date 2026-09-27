ALTER TABLE `builds` ADD `step` text;--> statement-breakpoint
ALTER TABLE `builds` ADD `upload_hash` text;--> statement-breakpoint
ALTER TABLE `builds` ADD `report_key` text;--> statement-breakpoint
ALTER TABLE `builds` ADD `report_bytes` integer;--> statement-breakpoint
ALTER TABLE `builds` ADD `card_key` text;--> statement-breakpoint
ALTER TABLE `builds` ADD `seconds` integer;--> statement-breakpoint
ALTER TABLE `builds` ADD `partial` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `status` text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `size_kb` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `report_lines` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `card_key` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `page_key` text;