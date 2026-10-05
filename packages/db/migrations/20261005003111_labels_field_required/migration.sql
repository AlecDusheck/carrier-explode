PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_labels` (
	`subject` text NOT NULL,
	`code` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`origin` text NOT NULL,
	`evidence` text,
	`updated` text NOT NULL,
	CONSTRAINT `labels_pk` PRIMARY KEY(`subject`, `code`, `field`)
);
--> statement-breakpoint
INSERT INTO `__new_labels`(`subject`, `code`, `field`, `value`, `origin`, `evidence`, `updated`) SELECT `subject`, `code`, `field`, `value`, `origin`, `evidence`, `updated` FROM `labels`;--> statement-breakpoint
DROP TABLE `labels`;--> statement-breakpoint
ALTER TABLE `__new_labels` RENAME TO `labels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;