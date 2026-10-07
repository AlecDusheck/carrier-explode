-- Galaxy packs key a carrier by GID1 and GID2 together, padded to 16 digits, where iOS keys it by plain network code or GID2
-- alone, so no rule is shared exactly; and two T-Mobile-hosted bundles state no status-bar name.
INSERT INTO `links` (`a`, `b`, `rule`, `why`) VALUES
	('samsung:carrier:VZW', 'ios:carrier:Verizon_LTE_US', 'link', 'Verizon: Galaxy keys 310590 and 311480 by GID1 BAE0000000000000 (Android''s carrier_list routes that GID1 to verizon_us), iOS by the codes alone'),
	('samsung:carrier:CHA', 'ios:carrier:Verizon_Charter_LTE_US', 'link', 'Spectrum Mobile on Verizon: Galaxy GID1 BA0149 with GID2 A7, iOS GID2 A7'),
	('samsung:carrier:CCT', 'ios:carrier:Verizon_Comcast_LTE_US', 'link', 'Xfinity Mobile on Verizon: Galaxy GID1 BA0145 with GID2 A3, iOS GID2 A3'),
	('samsung:carrier:FKR', 'ios:carrier:Verizon_Visible_LTE_US', 'link', 'Visible: Galaxy GID1 BAE1 with GID2 1A (and BAE2 with 1C), iOS GID2 1A and 1C');
--> statement-breakpoint
INSERT INTO `labels` (`subject`, `code`, `field`, `value`, `origin`, `evidence`) VALUES
	('source', 'ios:carrier:TMobile_Charter_US', 'carrierName', 'Spectrum Mobile', 'human', 'The bundle''s carrier.plist: CarrierName Spectrum, MyAccountURLTitle Spectrum Mobile'),
	('source', 'ios:carrier:TMobile_Comcast_US', 'carrierName', 'Comcast Business', 'human', 'The bundle''s carrier.plist: CarrierName Comcast Business, MyAccountURLTitle Comcast Business My Account');
