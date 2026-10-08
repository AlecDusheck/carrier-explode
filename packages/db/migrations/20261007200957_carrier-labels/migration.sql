-- A person's name for a source named its whole carrier; each now names the carrier that source heads after linking.
INSERT INTO `labels` (`subject`, `code`, `field`, `value`, `origin`, `evidence`)
SELECT 'carrier', m.`column2`, 'name', l.`value`, l.`origin`, l.`evidence`
FROM `labels` l JOIN (VALUES
	('android:carrier:ee_gb', 'TMobile_uk'),
	('android:carrier:tmobile_nl', 'tmobile_nl'),
	('ios:carrier:Verizon_Visible_LTE_US', 'Verizon_Core_Visible_LTE_US'),
	('ios:carrier:Verizon_Comcast_LTE_US', 'Verizon_Comcast_LTE_US'),
	('ios:carrier:Verizon_Charter_LTE_US', 'CHA'),
	('ios:carrier:Verizon_Cox_LTE_US', 'Verizon_Cox_LTE_US'),
	('ios:carrier:O2_Giffgaff_UK', 'giffgaff_gb'),
	('ios:carrier:Telus_Koodo_ca', 'Telus_Koodo_ca'),
	('ios:carrier:Telus_PublicMobile_ca', 'publicmobile_ca'),
	('ios:carrier:TMobile_UltraMint_US', 'TMobile_UltraMint_US'),
	('ios:carrier:TMobile_Charter_US', 'SPT'),
	('ios:carrier:TMobile_Comcast_US', 'XMT')
) m ON m.`column1` = l.`code`
WHERE l.`subject` = 'source' AND l.`field` = 'carrierName'
ON CONFLICT (`subject`, `code`, `field`) DO UPDATE SET `value` = excluded.`value`, `origin` = excluded.`origin`, `evidence` = excluded.`evidence`;
--> statement-breakpoint
DELETE FROM `labels` WHERE `subject` = 'source';
--> statement-breakpoint
INSERT INTO `links` (`a`, `b`, `rule`, `why`) VALUES
	('samsung:carrier:VZW', 'android:carrier:mediacom_us', 'split', 'Mediacom Mobile on Verizon: VZW''s pack lists its GID1 BA0170 among its MVNOs'' and shares one rule with verizon_us, so Mediacom is its best match');
