CREATE TABLE `labels` (
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`text` text NOT NULL,
	`origin` text NOT NULL,
	`evidence` text,
	`updated` text NOT NULL,
	CONSTRAINT `labels_pk` PRIMARY KEY(`kind`, `code`)
);
