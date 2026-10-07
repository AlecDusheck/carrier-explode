CREATE TABLE `carriers` (
	`id` text PRIMARY KEY,
	`name` text,
	`iso` text
);
--> statement-breakpoint
CREATE TABLE `changes` (
	`platform` text NOT NULL,
	`release` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`from_line` text,
	`from_slug` text,
	`to_line` text,
	`to_slug` text,
	CONSTRAINT `changes_pk` PRIMARY KEY(`platform`, `release`, `source`),
	CONSTRAINT "changes_ends" CHECK(("kind" = 'added') = ("from_slug" IS NULL) AND ("kind" = 'removed') = ("to_slug" IS NULL)
    AND ("from_line" IS NULL) = ("from_slug" IS NULL) AND ("to_line" IS NULL) = ("to_slug" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `concepts` (
	`source` text NOT NULL,
	`concept` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `concepts_pk` PRIMARY KEY(`source`, `concept`)
);
--> statement-breakpoint
CREATE TABLE `copies` (
	`source` text NOT NULL,
	`line` text NOT NULL,
	`sha` text NOT NULL,
	`version` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin` text NOT NULL,
	`os` text,
	CONSTRAINT `copies_pk` PRIMARY KEY(`source`, `line`, `sha`, `version`, `origin_kind`, `origin`),
	CONSTRAINT "copies_origin" CHECK("origin_kind" IN ('release', 'ota') AND ("origin_kind" = 'ota' OR "os" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`code` text PRIMARY KEY,
	`platform` text NOT NULL,
	`released` text NOT NULL,
	`boards` text NOT NULL,
	`has_5g` integer
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`source` text NOT NULL,
	`line` text NOT NULL,
	`rank` integer NOT NULL,
	`slug` text NOT NULL,
	`version` text NOT NULL,
	`sha` text NOT NULL,
	`beta` integer NOT NULL,
	`changed` integer NOT NULL,
	`day` text,
	CONSTRAINT `entries_pk` PRIMARY KEY(`source`, `line`, `slug`)
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`subject` text NOT NULL,
	`code` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`origin` text NOT NULL,
	`evidence` text,
	CONSTRAINT `labels_pk` PRIMARY KEY(`subject`, `code`, `field`)
);
--> statement-breakpoint
CREATE TABLE `links` (
	`a` text NOT NULL,
	`b` text NOT NULL,
	`rule` text NOT NULL,
	`why` text NOT NULL,
	CONSTRAINT `links_pk` PRIMARY KEY(`a`, `b`)
);
--> statement-breakpoint
CREATE TABLE `modem_configs` (
	`platform` text NOT NULL,
	`release` text NOT NULL,
	`firmware` text NOT NULL,
	`label` text NOT NULL,
	`sha` text NOT NULL,
	CONSTRAINT `modem_configs_pk` PRIMARY KEY(`platform`, `release`, `firmware`, `label`)
);
--> statement-breakpoint
CREATE TABLE `modems` (
	`platform` text NOT NULL,
	`release` text NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`devices` text NOT NULL,
	`package` text,
	`size` integer,
	`kind` text,
	CONSTRAINT `modems_pk` PRIMARY KEY(`platform`, `release`, `name`),
	CONSTRAINT "modems_package" CHECK(("platform" = 'ios') = ("package" IS NOT NULL)
    AND ("package" IS NULL) = ("size" IS NULL) AND ("package" IS NULL) = ("kind" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `ota_files` (
	`url` text PRIMARY KEY,
	`sha` text NOT NULL,
	`version` text NOT NULL,
	`published` text,
	`digests` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phone_states` (
	`device` text NOT NULL,
	`source` text NOT NULL,
	`states` text NOT NULL,
	`defaults` text NOT NULL,
	CONSTRAINT `phone_states_pk` PRIMARY KEY(`device`, `source`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`sha` text PRIMARY KEY,
	`schema` integer NOT NULL,
	`kind` text NOT NULL,
	`display` text,
	`iso` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`platform` text NOT NULL,
	`id` text NOT NULL,
	`version` text NOT NULL,
	`label` text,
	`released` text,
	`prerelease` integer,
	`patch` text,
	`devices` text NOT NULL,
	`source_count` integer NOT NULL,
	`sort_key` text NOT NULL,
	CONSTRAINT `releases_pk` PRIMARY KEY(`platform`, `id`),
	CONSTRAINT "releases_header" CHECK(("platform" = 'ios') = ("label" IS NOT NULL) AND ("platform" = 'ios') = ("prerelease" IS NOT NULL)
    AND ("platform" = 'android') = ("patch" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`source` text NOT NULL,
	`matcher` text NOT NULL,
	CONSTRAINT `routes_pk` PRIMARY KEY(`source`, `matcher`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`source` text NOT NULL,
	`file` text NOT NULL,
	`key` text NOT NULL,
	`path` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `settings_pk` PRIMARY KEY(`source`, `file`, `key`)
);
--> statement-breakpoint
CREATE TABLE `sims` (
	`sha` text NOT NULL,
	`matcher` text NOT NULL,
	CONSTRAINT `sims_pk` PRIMARY KEY(`sha`, `matcher`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`key` text PRIMARY KEY,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`head_sha` text NOT NULL,
	`updated` text,
	`carrier` text
);
--> statement-breakpoint
CREATE INDEX `carriers_by_iso` ON `carriers` (`iso`);--> statement-breakpoint
CREATE INDEX `copies_by_origin` ON `copies` (`origin_kind`,`origin`,`source`);--> statement-breakpoint
CREATE INDEX `devices_by_platform` ON `devices` (`platform`,`released`);--> statement-breakpoint
CREATE UNIQUE INDEX `entries_by_rank` ON `entries` (`source`,`line`,`rank`);--> statement-breakpoint
CREATE INDEX `phone_states_by_source` ON `phone_states` (`source`);--> statement-breakpoint
CREATE INDEX `releases_by_sort` ON `releases` (`platform`,`sort_key`);--> statement-breakpoint
CREATE INDEX `settings_by_path` ON `settings` (`file`,`path`,`value`,`source`);--> statement-breakpoint
CREATE INDEX `sims_by_matcher` ON `sims` (`matcher`);--> statement-breakpoint
CREATE INDEX `sources_by_list` ON `sources` (`platform`,`kind`,`name`);--> statement-breakpoint
CREATE INDEX `sources_by_carrier` ON `sources` (`carrier`);