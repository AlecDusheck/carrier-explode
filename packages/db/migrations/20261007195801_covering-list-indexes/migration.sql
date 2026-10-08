DROP INDEX IF EXISTS `devices_by_platform`;--> statement-breakpoint
DROP INDEX IF EXISTS `modem_configs_by_sha`;--> statement-breakpoint
DROP INDEX IF EXISTS `releases_by_sort`;--> statement-breakpoint
CREATE INDEX `devices_list` ON `devices` (`platform`,`code`,`released`,`boards`,`has_5g`);--> statement-breakpoint
CREATE INDEX `labels_lookup` ON `labels` (`subject`,`code`,`field`,`origin`,`value`);--> statement-breakpoint
CREATE INDEX `modem_configs_by_device` ON `modem_configs` (`platform`,`release`,`device`,`label`,`sha`);--> statement-breakpoint
CREATE INDEX `modems_families` ON `modems` (`platform`,`release`,`name`,`devices`,`family`);--> statement-breakpoint
CREATE INDEX `releases_list` ON `releases` (`platform`,`sort_key`,`id`,`version`,`label`,`released`,`prerelease`,`patch`,`devices`,`source_count`);--> statement-breakpoint
CREATE INDEX `releases_sort_by_id` ON `releases` (`platform`,`id`,`sort_key`);