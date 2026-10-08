-- FUS names a model `Galaxy S26 Ultra (SM-S948U)`; the check kept the part before its model code.
UPDATE `labels` SET `value` = `value` || ' (' || `code` || ')'
WHERE `subject` = 'device' AND `field` = 'name' AND `origin` = 'feed'
	AND `evidence` = 'https://neofussvr.sslcs.cdngc.net/NF_SmartDownloadBinaryInform.do'
	AND `value` NOT LIKE '%(' || `code` || ')';
