ALTER TABLE `repositories` ADD `github_id` integer;--> statement-breakpoint
CREATE INDEX `builds_repo_requested` ON `builds` (`repo_id`,`requested_at`);