CREATE TABLE `names` (
	`subject` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL,
	CONSTRAINT `names_pk` PRIMARY KEY(`subject`, `code`)
);
--> statement-breakpoint
CREATE TABLE `phones` (
	`code` text PRIMARY KEY,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`has_5g` integer NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `labels` RENAME COLUMN `kind` TO `subject`;--> statement-breakpoint
ALTER TABLE `labels` RENAME COLUMN `text` TO `value`;--> statement-breakpoint
ALTER TABLE `labels` ADD `field` text DEFAULT 'name' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_labels` (
	`subject` text NOT NULL,
	`code` text NOT NULL,
	`field` text DEFAULT 'name' NOT NULL,
	`value` text NOT NULL,
	`origin` text NOT NULL,
	`evidence` text,
	`updated` text NOT NULL,
	CONSTRAINT `labels_pk` PRIMARY KEY(`subject`, `code`, `field`)
);
--> statement-breakpoint
INSERT INTO `__new_labels`(`subject`, `code`, `value`, `origin`, `evidence`, `updated`) SELECT `subject`, `code`, `value`, `origin`, `evidence`, `updated` FROM `labels`;--> statement-breakpoint
DROP TABLE `labels`;--> statement-breakpoint
ALTER TABLE `__new_labels` RENAME TO `labels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `names_by_name` ON `names` (`subject`,`name`);--> statement-breakpoint
DROP TABLE `phone_radios`;