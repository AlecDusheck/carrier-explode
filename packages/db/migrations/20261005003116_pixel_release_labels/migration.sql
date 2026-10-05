-- Google's OTA page dropped these phones' first builds; source.android.com's build numbers still list them (first security patch levels).
INSERT INTO `labels` (`subject`, `code`, `field`, `value`, `origin`, `evidence`, `updated`) VALUES
	('device', 'bluejay', 'released', '2022-04', 'human', 'https://source.android.com/docs/setup/reference/build-numbers (SD2A.220123.051.A3, security patch 2022-04-05)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('device', 'sunfish', 'released', '2020-05', 'human', 'https://source.android.com/docs/setup/reference/build-numbers (QD4A.200317.027, security patch 2020-05-05)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (`subject`, `code`, `field`) DO NOTHING;
