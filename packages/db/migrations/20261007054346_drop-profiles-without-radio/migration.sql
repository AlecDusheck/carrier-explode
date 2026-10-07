-- A profile row written before radios is written again by the reindex that follows; its sims go with it.
DELETE FROM `sims` WHERE `sha` IN (SELECT `sha` FROM `profiles` WHERE `radio` IS NULL);
--> statement-breakpoint
DELETE FROM `profiles` WHERE `radio` IS NULL;
