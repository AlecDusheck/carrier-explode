# Tests

`pnpm test` runs against `test/fixtures`:

    mav25/   cut from Mav25-2.10.01.Release.bbfw (iOS 27.0 24A437, iPhone18,1)
    prl/     CDMA PRLs
    pixel5a/ cut from a Pixel 5a (barbet) vendor image's rfs/msm/mpss/readonly/vendor/mbn:
             dcm-cut.mbn          mcfg_sw/generic/Pixel/APAC/DCM/pixel_Commercial/mcfg_sw.mbn
                                  with 5 of its 108 items and the trailer; the hash segment is
                                  dropped, the MCFG segment moved to 0x200 and the program
                                  headers and item count patched; NV 3533 and global_throttling
                                  changed, the digest TLV replaced by '0's
             mcfg_sel_db-cut.xml  6 of the 125 rules of mcfg_hw.mbn's mcfg_sel_db.xml; comments
                                  replaced, one customid changed

They are altered copies, made the way decode-ios's `test/README.md` describes: values
changed, every format kept valid, expected values read back out of the altered
files. decode-ios's baseband tests read `mav25/` too.

Two corpus tests run when `CORPUS` points at a directory laid out as decode-ios's
`test/README.md` describes: `prl/*.prl`, and `android/mbn/`, a Pixel 5a's vendor
`mbn` directory (every MBN parses; SW configs pair with the selection database).
