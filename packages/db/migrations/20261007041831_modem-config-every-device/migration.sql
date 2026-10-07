INSERT INTO `modem_configs` (`platform`, `release`, `device`, `label`, `sha`)
SELECT c.`platform`, c.`release`, j.`value`, c.`label`, c.`sha`
FROM `modem_configs` c
JOIN `modems` m ON m.`platform` = c.`platform` AND m.`release` = c.`release` AND json_extract(m.`devices`, '$[0]') = c.`device`,
	json_each(m.`devices`) j
WHERE j.`key` > 0;
