#!/usr/bin/env python3
"""Parser for Apple C1/C1X modem firmware packages (Firmware/c4000*/Release/patched/ftab.bin).
The .der.pri / .der.gri carrier files they consume are decoded by src/lib/decode/pri.ts.

Subcommands (add --json for machine-readable output):
  info     FTAB                 build string, entry table, entry kinds
  extract  FTAB OUTDIR          write every entry; LZFSE-wrapped board blobs also as <tag>.raw
  hwid     FTAB                 HWID -> blob-set table (rcpi) joined with the rkos board table
  verify   FTAB                 check every rcpi SHA-384 digest against the entry bytes
  segments FTAB [TAG]           'fwsg' segment table of a code image (rkos, l1cs, cdpu, cdpd, cdph)
  car      FTAB [TAG]           section table of a CAR2/CAR3 image
  fetch    IPSW_URL OUT         copy the modem ftab member out of a remote IPSW via HTTP ranges

Only the Python standard library is required; fetch also uses the repo's scripts/net.py.
LZFSE uses libcompression when present (macOS) and a pure-Python decoder otherwise (lzfse.py).
"""
import argparse
import collections
import hashlib
import json
import math
import os
import re
import shutil
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lzfse  # noqa: E402

# ---------------------------------------------------------------------------
# ftab container
# ---------------------------------------------------------------------------


def parse_ftab(buf):
    """Return [{tag, off, size}] for an 'rkos'/'ftab' container."""
    if buf[0x20:0x24] != b"rkos" or buf[0x24:0x28] != b"ftab":
        raise ValueError("not an rkos/ftab container")
    n = struct.unpack_from("<I", buf, 0x28)[0]
    out = []
    for i in range(n):
        tag, off, size, _pad = struct.unpack_from("<4sIII", buf, 0x30 + 16 * i)
        out.append({"tag": tag.decode("latin1").rstrip("\0"), "off": off, "size": size})
    return out


def entries(buf):
    return {e["tag"]: buf[e["off"]:e["off"] + e["size"]] for e in parse_ftab(buf)}


def entropy(b):
    if not b:
        return 0.0
    c = collections.Counter(b)
    n = len(b)
    return -sum(v / n * math.log2(v / n) for v in c.values())


def classify(tag, d):
    if len(d) >= 16 and d[12:16] == b"bvx2":
        return "board-blob (LZFSE)"
    if d[:4] == b"\xfe\xca\xed\xfe":
        return "CAR image (0xFEEDCAFE, ARC cores)"
    if tag == "rcpi":
        return "HWID table + SHA-384 manifest"
    if tag == "bver":
        return "build string"
    if tag == "ibdt":
        return "boot device-tree stub"
    if d.strip() == b"empty":
        return "placeholder"
    if 0 <= d.rfind(b"fwsg") and d.rfind(b"fwsg") > len(d) - 0x100:
        return "code image (fwsg segments)"
    if b"DesignWare ARC" in d:
        return "ARC firmware (GNSS)"
    if b"iBoot for" in d:
        return "modem boot loader"
    if d[:5] == b"t5088":
        return "PMU firmware/config"
    return ""


# ---------------------------------------------------------------------------
# board blobs (CRnn / R1nn / RPnn / R203)
# ---------------------------------------------------------------------------
BLOB_MAGIC = {0xDEADC101: "R", 0xDEADC201: "R203", 0xDEADC301: "RP"}


def blob_header(d):
    """{cfg_id, raw_size, lzfse_size} or None."""
    if len(d) < 16 or d[12:16] != b"bvx2":
        return None
    cfg, raw, clen = struct.unpack_from("<III", d, 0)
    return {"cfg_id": cfg, "raw_size": raw, "lzfse_size": clen}


def blob_decompress(d):
    h = blob_header(d)
    raw = lzfse.decompress(d[12:12 + h["lzfse_size"]], h["raw_size"])
    if len(raw) != h["raw_size"]:
        raise ValueError("decompressed size mismatch")
    return raw


def fwsg_table(d):
    """Parse a trailing 'fwsg' segment table: [{name, vaddr, off, filesize, vmsize, flags}]."""
    t = d.rfind(b"fwsg")
    if t < 0:
        return []
    _ver, tab, cnt = struct.unpack_from("<III", d, t + 4)
    segs = []
    for i in range(cnt):
        va, off, fs, vs, fl = struct.unpack_from("<QIIII", d, tab + 32 * i)
        name = d[tab + 32 * i + 24:tab + 32 * i + 32].rstrip(b"\0").decode("latin1")
        segs.append({"name": name, "vaddr": va, "off": off, "filesize": fs, "vmsize": vs, "flags": fl})
    return segs


# ---------------------------------------------------------------------------
# rcpi: HWID -> blob set, SHA-384 manifest, chip revisions, signing authority
# ---------------------------------------------------------------------------


def parse_rcpi(d):
    m = re.search(rb"[ -~]{4,}\.csv", d[:0x34])
    r = {"version": d[4:8].decode("latin1"), "source": m.group().decode() if m else ""}
    _z, _one, n = struct.unpack_from("<HII", d, 0x34)
    p = 0x3E
    rows = []
    for _ in range(n):
        hw, _z2, ln = struct.unpack_from("<III", d, p)
        tags = [d[p + 12 + 4 * k:p + 16 + 4 * k].decode("latin1") for k in range(ln // 4)]
        rows.append({"hwid": hw, "tags": tags})
        p += 12 + ln
    r["rows"] = rows
    sec, n = struct.unpack_from("<II", d, p); p += 8
    r["digests"] = {}
    for _ in range(n):
        r["digests"][d[p:p + 4].decode("latin1")] = d[p + 4:p + 52].hex(); p += 52
    sec, nrev = struct.unpack_from("<II", d, p); p += 8
    r["chip_revisions"] = {}
    for _ in range(nrev):
        rev = d[p:p + 4].rstrip(b"\0").decode("latin1")[::-1]
        c = struct.unpack_from("<I", d, p + 4)[0]; p += 8
        r["chip_revisions"][rev] = [d[p + 8 * k + 4:p + 8 * k + 8].decode("latin1") for k in range(c)]
        p += 8 * c
    sec, c = struct.unpack_from("<II", d, p); p += 8
    r["authority"] = {d[p + 8 * k:p + 8 * k + 4].decode("latin1"): d[p + 8 * k + 4:p + 8 * k + 8].decode("latin1")
                      for k in range(c)}
    return r


def rkos_board_table(rkos, r203_id):
    """Board records embedded in rkos (0x60 bytes each, located by the R203 config id).

    Record words: [0] cfg_id  [1] 1  [2..6] 0x63 x5  [7] R203 cfg_id  [8..11] 1,2,1,2
                  [12] A  [13] B  [14] C  [15] D  [16] HWID  [17] E  [18..23] unknown
    cfg_id == (100 + A) * 10000 + rev * 100 + E  (decimal), E is a SKU code shared across products.
    """
    pat = struct.pack("<I", r203_id)
    recs = []
    for m in re.finditer(re.escape(pat), rkos):
        o = m.start() - 0x1C
        if o < 0 or o + 0x60 > len(rkos):
            continue
        w = struct.unpack_from("<24I", rkos, o)
        if w[1] != 1 or w[8:12] != (1, 2, 1, 2) or w[2] != 0x63:
            continue
        recs.append({"cfg_id": w[0], "A": w[12], "B": w[13], "C": w[14], "D": w[15],
                     "hwid": w[16], "E": w[17], "tail": list(w[18:24]), "rkos_off": o})
    return recs


def hwid_table(ents):
    rc = parse_rcpi(ents["rcpi"])
    cfg = {t: blob_header(d)["cfg_id"] for t, d in ents.items() if blob_header(d)}
    board = rkos_board_table(ents["rkos"], cfg.get("R203", 0x0BEBC1FF)) if "rkos" in ents else []
    by_hw = {b["hwid"]: b for b in board}
    rows = []
    for r in rc["rows"]:
        t = r["tags"]
        cr = next((x for x in t if x.startswith("CR")), None)
        row = {"hwid": r["hwid"], "tags": t, "cfg_id": cfg.get(cr)}
        b = by_hw.get(r["hwid"])
        if b:
            row.update({k: b[k] for k in ("A", "B", "C", "D", "E")})
            row["rkos_cfg_id"] = b["cfg_id"]
        rows.append(row)
    return rc, rows, board


# ---------------------------------------------------------------------------
# CAR images
# ---------------------------------------------------------------------------


def parse_car(d):
    magic, _z, h1, h2, _a, _b, cnt = struct.unpack_from("<IIIIIII", d, 0)
    if magic != 0xFEEDCAFE:
        raise ValueError("not a CAR image")
    base = 0x1C + 0x20 * cnt + 4
    secs = []
    for i in range(cnt):
        sid, off, size, _z3, addr = struct.unpack_from("<IIIII", d, 0x1C + 0x20 * i)
        s = d[base + off * 4:base + (off + size) * 4]
        secs.append({"id": sid, "file_off": base + off * 4, "size": size * 4, "load": addr,
                     "entropy": round(entropy(s), 2)})
    return {"magic": hex(magic), "hdr_words": [hex(h1), hex(h2)], "sections": secs,
            "end": base + sum(s["size"] for s in secs), "file_size": len(d)}


# ---------------------------------------------------------------------------
# remote IPSW member fetch (HTTP Range)
# ---------------------------------------------------------------------------


def fetch(url, out, pattern=r"^Firmware/c\d+[^/]*/.*ftab\.bin$"):
    # The repo's range reader (scripts/net.py); only this subcommand needs it.
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
    from net import open_zip

    with open_zip(url) as z:
        names = [i.filename for i in z.infolist() if re.search(pattern, i.filename)]
        if not names:
            raise SystemExit("no member matches %s" % pattern)
        with z.open(names[0]) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 22)
    return names[0]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _out(args, obj, text):
    if args.json:
        print(json.dumps(obj, indent=1, default=str))
    else:
        print(text)


def cmd_info(a):
    buf = open(a.ftab, "rb").read()
    rows, lines = [], []
    for e in parse_ftab(buf):
        d = buf[e["off"]:e["off"] + e["size"]]
        h = blob_header(d)
        row = dict(e, kind=classify(e["tag"], d), entropy=round(entropy(d[:1 << 20]), 2))
        if h:
            row.update(h)
        rows.append(row)
        extra = " cfg_id=%d raw=%d" % (h["cfg_id"], h["raw_size"]) if h else ""
        lines.append("%-4s off=0x%08x size=%10d H=%.2f %s%s" % (e["tag"], e["off"], e["size"], row["entropy"], row["kind"], extra))
    ents = entries(buf)
    bver = ents.get("bver", b"").decode("latin1").strip()
    _out(a, {"bver": bver, "entries": rows}, "bver: %s\n%s" % (bver, "\n".join(lines)))


def cmd_extract(a):
    buf = open(a.ftab, "rb").read()
    os.makedirs(a.outdir, exist_ok=True)
    man = []
    for tag, d in entries(buf).items():
        open(os.path.join(a.outdir, tag + ".bin"), "wb").write(d)
        m = {"tag": tag, "size": len(d)}
        if blob_header(d) and not a.no_decompress:
            raw = blob_decompress(d)
            open(os.path.join(a.outdir, tag + ".raw"), "wb").write(raw)
            m.update(blob_header(d), magic=hex(struct.unpack_from("<I", raw, 4)[0]))
        man.append(m)
    json.dump(man, open(os.path.join(a.outdir, "manifest.json"), "w"), indent=1)
    print("wrote %d entries to %s" % (len(man), a.outdir))


def cmd_hwid(a):
    ents = entries(open(a.ftab, "rb").read())
    rc, rows, board = hwid_table(ents)
    lines = ["rcpi %s  source=%s  rows=%d  chip revisions=%s" % (rc["version"], rc["source"], len(rows), ",".join(rc["chip_revisions"])),
             "HWID  A  B    E   cfg_id   blob set"]
    for r in rows:
        lines.append("0x%02x %2s %4s %4s %8s  %s" % (r["hwid"], r.get("A", "?"), hex(r["B"]) if "B" in r else "?",
                                                   r.get("E", "?"), r["cfg_id"], " ".join(r["tags"])))
    lines.append("rkos board table: %d records (%d without blobs in this ftab)" %
                 (len(board), len({b["hwid"] for b in board} - {r["hwid"] for r in rows})))
    _out(a, {"rcpi": rc, "rows": rows, "rkos_board_table": board}, "\n".join(lines))


def cmd_verify(a):
    ents = entries(open(a.ftab, "rb").read())
    rc = parse_rcpi(ents["rcpi"])
    res = {}
    for tag, dg in rc["digests"].items():
        res[tag] = "absent" if tag not in ents else ("ok" if hashlib.sha384(ents[tag]).hexdigest() == dg else "MISMATCH")
    c = collections.Counter(res.values())
    _out(a, res, "%s\n%s" % (dict(c), "\n".join("%s %s" % kv for kv in res.items() if kv[1] != "ok")))


def cmd_segments(a):
    ents = entries(open(a.ftab, "rb").read())
    tags = [a.tag] if a.tag else [t for t in ("rkos", "l1cs", "cdpu", "cdpd", "cdph") if t in ents]
    obj, lines = {}, []
    for t in tags:
        segs = fwsg_table(ents[t])
        obj[t] = segs
        lines.append("## %s (%d segments)" % (t, len(segs)))
        for s in segs:
            lines.append("  %-10s va=0x%x off=0x%x filesz=0x%x vmsz=0x%x flags=%d" % (s["name"], s["vaddr"], s["off"], s["filesize"], s["vmsize"], s["flags"]))
    _out(a, obj, "\n".join(lines))


def cmd_car(a):
    ents = entries(open(a.ftab, "rb").read())
    tags = [a.tag] if a.tag else [t for t in ents if t.startswith("CAR")]
    obj = {t: parse_car(ents[t]) for t in tags}
    lines = []
    for t, c in obj.items():
        lines.append("## %s end=0x%x file=0x%x" % (t, c["end"], c["file_size"]))
        for s in c["sections"]:
            lines.append("  id=%d off=0x%x size=0x%x load=0x%08x H=%.2f" % (s["id"], s["file_off"], s["size"], s["load"], s["entropy"]))
    _out(a, obj, "\n".join(lines))


def cmd_fetch(a):
    name = fetch(a.url, a.out)
    print("fetched %s -> %s" % (name, a.out))


def main(argv=None):
    try:
        import signal
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    except (ImportError, AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="JSON output")
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("info"); p.add_argument("ftab"); p.set_defaults(f=cmd_info)
    p = sp.add_parser("extract"); p.add_argument("ftab"); p.add_argument("outdir")
    p.add_argument("--no-decompress", action="store_true"); p.set_defaults(f=cmd_extract)
    p = sp.add_parser("hwid"); p.add_argument("ftab"); p.set_defaults(f=cmd_hwid)
    p = sp.add_parser("verify"); p.add_argument("ftab"); p.set_defaults(f=cmd_verify)
    p = sp.add_parser("segments"); p.add_argument("ftab"); p.add_argument("tag", nargs="?"); p.set_defaults(f=cmd_segments)
    p = sp.add_parser("car"); p.add_argument("ftab"); p.add_argument("tag", nargs="?"); p.set_defaults(f=cmd_car)
    p = sp.add_parser("fetch"); p.add_argument("url"); p.add_argument("out"); p.set_defaults(f=cmd_fetch)
    a = ap.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
