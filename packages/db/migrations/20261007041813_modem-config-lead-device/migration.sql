UPDATE `modem_configs` SET `device` = (
	SELECT json_extract(m.`devices`, '$[0]') FROM `modems` m
	WHERE m.`platform` = `modem_configs`.`platform` AND m.`release` = `modem_configs`.`release` AND m.`name` = `modem_configs`.`firmware`
);
