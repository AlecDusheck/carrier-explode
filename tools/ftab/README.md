# ftab: Apple C1/C1X modem firmware package parser

Reads the modem package `Firmware/c4000v59/Release/patched/ftab.bin`. One byte-identical copy
ships per iOS build to iPhone 16e (iPhone17,5), iPhone Air (iPhone18,4) and iPhone 17e (iPhone18,5).
It needs only the Python 3 standard library.

## Usage

```
python3 ftab.py info     ftab.bin              # build string, entries, kinds, board-blob ids
python3 ftab.py extract  ftab.bin OUT/         # <tag>.bin per entry, <tag>.raw for LZFSE board blobs, manifest.json
python3 ftab.py hwid     ftab.bin              # HWID -> blob set (rcpi) joined with the rkos board table
python3 ftab.py verify   ftab.bin              # SHA-384 of every entry vs. the rcpi manifest
python3 ftab.py segments ftab.bin [rkos]       # 'fwsg' segment table of a code image
python3 ftab.py car      ftab.bin [CAR2]       # section table of a CAR image
python3 ftab.py fetch    <ipsw-url> ftab.bin   # copy the modem ftab out of a remote IPSW (HTTP Range, scripts/net.py)
```

Add `--json` before the subcommand to get machine-readable output. `lzfse.py` is a standalone
LZFSE/LZVN decoder. It uses libcompression on macOS and falls back to pure Python elsewhere
(about 1 s for a 12 MB blob). Both paths are byte-identical to `compression_tool` on the
24A437 blobs, and the LZVN (`bvxn`) and raw (`bvx-`) block paths are tested too.

The Intel-heritage `.der.pri` / `.der.gri` carrier files the C1 consumes are decoded by the
site's own decoder, `src/lib/decode/pri.ts` (with `intel.ts` for the key tree). To dump one,
from the repo root after `pnpm install`:

```
cat > /tmp/pri.ts <<'EOF'
import { readFileSync } from "node:fs";
import { decodePri } from "$lib/decode/pri";
console.log(JSON.stringify(decodePri(readFileSync(process.argv[2])), null, 1));
EOF
npx vite-node /tmp/pri.ts overrides_V59.der.pri
```

Entry extraction and blob decompression are also in blacktop/ipsw (`ipsw fw c1`,
https://github.com/blacktop/ipsw), and its output is byte-identical to `extract` here. This tool adds
the rcpi/HWID and board tables, digest verification, fwsg/CAR section tables, and a
Python-only path.

## Format notes

| Item | Layout | Confidence |
|---|---|---|
| ftab header | `0x20 'rkos' 'ftab'`, `0x28 u32 count`, entries at 0x30: `{tag[4], u32 off, u32 size, u32 0}` | high |
| board blobs `CRnn`, `RPnn`, `R1mm` (m = n+1), `R203` | `{u32 cfg_id, u32 raw_size, u32 lzfse_len}` + LZFSE stream (`bvx2`…`bvx$`). Decompressed: fixed-size `__DATA` image with an `fwsg` trailer. u32 at +4 is `0xDEADC101` (R), `0xDEADC301` (RP), `0xDEADC201` (R203), 0 (CR). Contents are binary RF tables. | high (format), low (semantics) |
| `cfg_id` | decimal `(100+A)·10⁴ + rev·10² + E`, e.g. 1070220 = platform 7, rev 02, SKU code 20 | medium |
| `rcpi` | `"0.01"`, source csv name (`Sinope_HWID_0046.csv`). Four sections: (1) rows `{u32 hwid, u32 0, u32 len, tag[4]…}` (CAR, ARC, GNS, R, R203, RP, CR); (2) `{tag, sha384}`; (3) chip revisions B0/C0 → code images; (4) `{tag, "IM4M"/"rcpi"}`, which says whether an entry is covered by the Image4 manifest or by rcpi | high |
| rkos board table | 0x60-byte records inside rkos `__TEXT`, found via the R203 cfg_id. Word 0 is cfg_id, word 16 is HWID, words 12..17 are A, B, C, D, HWID, E (meanings partly guessed) | medium |
| code images `rkos`, `l1cs`, `cdpu`, `cdpd`, `cdph` | plain arm64 (rkos = "pitayaOS" roottask `BB_C4000_CPS`, arm64e). Trailing `fwsg` table: `{u64 va, u32 off, u32 filesz, u32 vmsz, u32 flags, name[8]}` + `'fwsg' u32 1, u32 table_off, u32 count` | high |
| `CAR2`/`CAR3` | magic `0xFEEDCAFE` (not Mach-O). u32 count at 0x18, sections at 0x1c `{id, off_words, size_words, 0, load_addr, pad[3]}`, data after an `0xffffffff` terminator. Two code+data pairs at 0x609…/0x608… and 0x409…/0x408…; ARCompact code. Picked per HWID. | medium |
| `GNS1` | Synopsys DesignWare ARC GNSS firmware, plain (`Project: CP`, `INITIUM25-x.y.z`) | high |

Nothing in the package is encrypted. Integrity comes from the SHA-384 digests in `rcpi` and
the Image4 manifest. The tool only reads and verifies; it does not modify or re-sign anything.

## Limits

- The meanings of CR/R/RP and of the rkos board fields A..E are inferred from structure and
  release history, not from symbols.
- `bvx1` (uncompressed-header LZFSE v1) blocks are not supported by the pure-Python path.
  Apple's encoder does not emit them.
