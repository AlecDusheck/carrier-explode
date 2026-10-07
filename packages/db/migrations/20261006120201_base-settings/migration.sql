CREATE TABLE `base_settings` (
	`sha` text NOT NULL,
	`file` text NOT NULL,
	`key` text NOT NULL,
	`path` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `base_settings_pk` PRIMARY KEY(`sha`, `file`, `key`)
);
--> statement-breakpoint
ALTER TABLE `sources` ADD `base_sha` text;--> statement-breakpoint
CREATE INDEX `base_settings_by_path` ON `base_settings` (`file`,`path`,`sha`);