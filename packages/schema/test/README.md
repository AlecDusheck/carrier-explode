# Tests

`pnpm test` runs against fixtures read by path from the packages that own them
(`decode-ios`, `decode-qualcomm`, `decode-shannon` and `decode-mediatek`'s `test/fixtures`);
their tests and READMEs say how each was made.

One corpus test runs when `CORPUS` points at a directory laid out as decode-ios's
`test/README.md` describes, plus:

    modem/pixel5a_TMO_Commercial_mcfg_sw.mbn               a Pixel 5a's vendor mbn/mcfg_sw/generic/Pixel/NA/TMO/pixel_Commercial/mcfg_sw.mbn
    modem/pixel5a_mcfg_sel_db.xml                          its mcfg_hw.mbn's /nv/item_files/mcfg/mcfg_sel_db.xml
    modem/ios_TMobile_US_overrides_D93_D94_D47_D48.der.pri  TMobile_US.bundle's override for the iPhone 16 and 16 Pro

It checks that the Pixel and iPhone T-Mobile configurations share item ids for the
11 EFS paths both set.
