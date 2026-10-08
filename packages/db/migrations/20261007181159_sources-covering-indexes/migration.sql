DROP INDEX IF EXISTS `sources_by_list`;--> statement-breakpoint
DROP INDEX IF EXISTS `sources_by_carrier`;--> statement-breakpoint
CREATE INDEX `sources_list_page` ON `sources` (`platform`,`kind`,`name`,`key`,`head_sha`,`updated`,`carrier`);--> statement-breakpoint
CREATE INDEX `sources_carrier_members` ON `sources` (`carrier`,`key`,`name`);