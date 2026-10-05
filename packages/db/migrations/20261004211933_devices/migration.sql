CREATE TABLE `devices` (
	`code` text PRIMARY KEY,
	`family` text NOT NULL,
	`released` text NOT NULL,
	`boards` text NOT NULL,
	`evidence` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phone_radios` (
	`device` text PRIMARY KEY,
	`platform` text NOT NULL,
	`has_5g` integer NOT NULL,
	`hash` text NOT NULL,
	`built_at` text NOT NULL
);
