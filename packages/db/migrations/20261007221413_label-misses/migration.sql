CREATE TABLE `label_misses` (
	`subject` text NOT NULL,
	`code` text NOT NULL,
	`field` text NOT NULL,
	`searched` text NOT NULL,
	CONSTRAINT `label_misses_pk` PRIMARY KEY(`subject`, `code`, `field`)
);
