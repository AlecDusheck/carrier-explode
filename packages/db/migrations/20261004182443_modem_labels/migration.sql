-- Modem families named by people, moved out of decode-ios. Only where the family is known for certain to be that modem.
INSERT INTO `labels` (`kind`, `code`, `text`, `origin`, `evidence`, `updated`) VALUES
	('modem', 'Mav25', 'Qualcomm X80', 'human', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('modem', 'Mav24', 'Qualcomm X71M', 'human', 'TechInsights'' iPhone 16 teardown found an SDX71M, not the X75 first reported.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (`kind`, `code`) DO NOTHING;
