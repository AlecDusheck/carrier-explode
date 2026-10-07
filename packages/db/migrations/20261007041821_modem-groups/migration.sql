PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_modem_configs` (
	`platform` text NOT NULL,
	`release` text NOT NULL,
	`device` text NOT NULL,
	`label` text NOT NULL,
	`sha` text NOT NULL,
	CONSTRAINT `modem_configs_pk` PRIMARY KEY(`platform`, `release`, `device`, `label`)
);
--> statement-breakpoint
INSERT INTO `__new_modem_configs`(`platform`, `release`, `device`, `label`, `sha`) SELECT `platform`, `release`, `device`, `label`, `sha` FROM `modem_configs`;--> statement-breakpoint
DROP TABLE `modem_configs`;--> statement-breakpoint
ALTER TABLE `__new_modem_configs` RENAME TO `modem_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_modems` (
	`platform` text NOT NULL,
	`release` text NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`devices` text NOT NULL,
	`package` text,
	`size` integer,
	`kind` text,
	CONSTRAINT `modems_pk` PRIMARY KEY(`platform`, `release`, `name`, `devices`),
	CONSTRAINT "modems_package" CHECK(("platform" = 'ios') = ("package" IS NOT NULL)
    AND ("package" IS NULL) = ("size" IS NULL) AND ("package" IS NULL) = ("kind" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_modems`(`platform`, `release`, `name`, `family`, `devices`, `package`, `size`, `kind`) SELECT `platform`, `release`, `name`, `family`, `devices`, `package`, `size`, `kind` FROM `modems`;--> statement-breakpoint
DROP TABLE `modems`;--> statement-breakpoint
ALTER TABLE `__new_modems` RENAME TO `modems`;--> statement-breakpoint
PRAGMA foreign_keys=ON;