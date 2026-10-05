CREATE TABLE `carriers` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`iso` text,
	`carrier` text NOT NULL,
	`modems` text NOT NULL,
	`summary` text,
	`hash` text NOT NULL,
	`built_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `countries` (
	`iso` text PRIMARY KEY,
	`summary` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legacy` (
	`src` text PRIMARY KEY,
	`dst` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phone_states` (
	`device` text NOT NULL,
	`source` text NOT NULL,
	`states` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL,
	CONSTRAINT `phone_states_pk` PRIMARY KEY(`device`, `source`)
);
--> statement-breakpoint
CREATE TABLE `release_changes` (
	`platform` text NOT NULL,
	`release` text NOT NULL,
	`source` text NOT NULL,
	`change` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL,
	CONSTRAINT `release_changes_pk` PRIMARY KEY(`platform`, `release`, `source`)
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`platform` text NOT NULL,
	`id` text NOT NULL,
	`sort` integer NOT NULL,
	`summary` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL,
	CONSTRAINT `releases_pk` PRIMARY KEY(`platform`, `id`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`key` text PRIMARY KEY,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`carrier` text NOT NULL,
	`timeline` text NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `carriers_by_kind` ON `carriers` (`kind`,`iso`);--> statement-breakpoint
CREATE INDEX `sources_by_list` ON `sources` (`platform`,`kind`,`name`);--> statement-breakpoint
CREATE INDEX `sources_by_carrier` ON `sources` (`carrier`);