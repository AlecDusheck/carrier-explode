PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_profiles` (
	`sha` text PRIMARY KEY,
	`schema` integer NOT NULL,
	`kind` text NOT NULL,
	`display` text,
	`iso` text NOT NULL,
	`radio` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_profiles`(`sha`, `schema`, `kind`, `display`, `iso`, `radio`) SELECT `sha`, `schema`, `kind`, `display`, `iso`, `radio` FROM `profiles`;--> statement-breakpoint
DROP TABLE `profiles`;--> statement-breakpoint
ALTER TABLE `__new_profiles` RENAME TO `profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;