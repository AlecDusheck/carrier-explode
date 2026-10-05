CREATE INDEX `carriers_by_id` ON `carriers` (`kind`,`id`);--> statement-breakpoint
CREATE INDEX `releases_by_sort` ON `releases` (`platform`,`sort`);