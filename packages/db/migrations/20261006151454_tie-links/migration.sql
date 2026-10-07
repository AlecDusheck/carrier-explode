-- Sources the data ties with another candidate, so linking leaves them apart; each pair's shared SIM rules say one carrier.
INSERT INTO `links` (`a`, `b`, `rule`, `why`) VALUES
	('samsung:carrier:TMB', 'ios:carrier:TMobile_US', 'link', 'T-Mobile US: both claim the same 11 plain codes (310160 to 310800), as Galaxy TMK (Metro, GID1 6D38) does, so they tie; TMB''s GID1 544D begins with the 54 iOS T-Mobile keys by'),
	('android:carrier:h3_gb', 'ios:carrier:Hutchison_uk', 'link', 'Three UK: both take plain 23420; smarty_gb, which ties, is only 23420 with GID1 0309'),
	('android:carrier:telenor_se', 'ios:carrier:Telenor_se', 'link', 'Telenor Sweden: both take 24008, and 24004 (Android with SPN TELENOR SE); android 24004, which ties, is plain 24004 alone');
