#!/usr/bin/env python3
"""
Modem packages per iOS build, for every iPhone that received it.

Each iPhone IPSW carries the package for its modem: Firmware/<Family>-<v>.Release.bbfw
(Qualcomm, Intel) or Firmware/c<chip>…/Release/…/ftab.bin (Apple C1). Its BuildManifest
names it per board (BasebandFirmware, or the Cellular1,* entries), which is how an IPSW
shared by several phones says which modem each has. The zip directory and manifest are
read over HTTP ranges; packages are grouped by (name, size, CRC32) and stored once
however many builds and phones share them:

    blobs/<sha256>.bbfw | blobs/<sha256>.ftab   the package, as shipped
    baseband/<sha256>.json                      decoded (scripts/baseband.ts)
    system/<build>/index.json                   modems: [{family, package, devices}]

    modems.py plan --indexes DIR [--builds B ...] [--rebuild] [--legs 6] > plan.json
    modems.py fetch --url URL --member PATH --size N --crc32 HEX --out FILE
    modems.py write --plan plan.json --indexes DIR --meta DIR --out DIR

DIR/<build>/index.json are the held indexes. `plan` lists the packages no index points
at yet, split into legs for parallel jobs, and each build's modem list. `write` puts
those lists into the indexes once every package of a build is stored; --meta holds
what the fetch legs stored ({name, size, crc32, kind, id, family} per line).
"""

import argparse
import io
import json
import plistlib
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

UA = {"User-Agent": "carrier-explode"}
# Apple's CDN and ipsw.me are shared; a few requests at a time.
CONCURRENCY = 4


def get(url: str, headers: dict | None = None, method: str = "GET", tries: int = 5):
    """urlopen with retries and backoff; 404 is final."""
    for attempt in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}, method=method), timeout=60)
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def get_json(url: str):
    with get(url) as r:
        return json.load(r)


class RangeFile(io.RawIOBase):
    """A remote file, read by HTTP range requests, for zipfile."""

    def __init__(self, url: str):
        self.url, self.pos = url, 0
        with get(url, method="HEAD") as r:
            self.size = int(r.headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size or not len(b):
            return 0
        end = min(self.pos + len(b), self.size) - 1
        with get(self.url, {"Range": f"bytes={self.pos}-{end}"}) as r:
            data = r.read()
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)


def open_zip(url: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(RangeFile(url), buffer_size=1 << 20))


def modem_boards(manifest: dict) -> dict[str, set[str]]:
    """IPSW path -> boards it is the modem of. Not Rose (Rap,*) or Wi-Fi (Wireless1,*) ftabs."""
    out: dict[str, set[str]] = {}
    for bi in manifest.get("BuildIdentities", []):
        board = str(bi.get("Info", {}).get("DeviceClass", "")).lower()
        for k, v in bi.get("Manifest", {}).items():
            path = (v.get("Info") or {}).get("Path") if isinstance(v, dict) else None
            if path and (k == "BasebandFirmware" or k.startswith("Cellular1,")):
                out.setdefault(path, set()).add(board)
    return out


def modem_members(infos, manifest: dict) -> list[dict]:
    """
    Modem packages among zip entries (ZipInfo-like: filename, file_size, CRC).
    Names are the path under Firmware/; src/lib/decode/modem.ts reads the family off them.
    """
    boards = modem_boards(manifest)
    return [{"member": i.filename, "name": i.filename.removeprefix("Firmware/"), "size": i.file_size,
             "crc32": f"{i.CRC:08x}", "kind": "bbfw" if i.filename.endswith(".bbfw") else "ftab",
             "boards": sorted(boards[i.filename])}
            for i in infos if i.filename in boards]


def key(p: dict) -> tuple:
    return (p["name"], p["size"], p["crc32"])


def product_key(product: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", product)]


def group(ipsws: dict[str, list[str]], listings: dict[str, list[dict]], boards: dict[str, list[str]]) -> list[dict]:
    """
    One entry per distinct package in a build: `ipsws` maps IPSW URL -> devices it
    serves, `listings` URL -> modem_members(), `boards` device -> its boards. A phone
    whose boards are not known gets every modem of its IPSW. Newest phone first.
    """
    out: dict[tuple, dict] = {}
    for url in sorted(listings):
        for m in listings[url]:
            mine = [d for d in ipsws.get(url, []) if d not in boards or set(boards[d]) & set(m["boards"])]
            g = out.setdefault(key(m), {**m, "url": url, "devices": []})
            g["devices"] = sorted({*g["devices"], *mine}, key=product_key)
    return sorted(out.values(), key=lambda g: ([-x for x in product_key(g["devices"][-1])] if g["devices"] else [], g["name"]))


def stored(indexes: dict[str, dict]) -> dict[tuple, dict]:
    """Packages some index already points at: blob and summary are in the bucket."""
    out = {}
    for idx in indexes.values():
        for m in idx.get("modems", []):
            out[key(m["package"])] = {**m["package"], "family": m["family"]}
    return out


def plan(indexes: dict[str, dict], groups: dict[str, list[dict]], legs: int) -> dict:
    """What to fetch, round-robin over `legs`, and every build's modem list."""
    have = stored(indexes)
    todo: dict[tuple, dict] = {}
    for build in groups:
        for g in groups[build]:
            if key(g) not in have:
                todo.setdefault(key(g), {k: g[k] for k in ("name", "size", "crc32", "kind", "url", "member")})
    lists = {b: [{k: g[k] for k in ("name", "size", "crc32", "kind", "devices")} for g in gs] for b, gs in groups.items()}
    return {"legs": split(list(todo.values()), legs), "builds": lists}


def plan_rebuild(indexes: dict[str, dict], legs: int) -> dict:
    """Every stored package, decoded again from its blob."""
    pkgs = sorted(stored(indexes).values(), key=lambda p: p["id"])
    return {"legs": split([{k: p[k] for k in ("id", "name", "size", "crc32", "kind")} for p in pkgs], legs), "builds": {}}


def split(items: list, legs: int) -> list[list]:
    return [x for x in (items[i::legs] for i in range(max(1, legs))) if x]


def modems_of(groups: list[dict], known: dict[tuple, dict]) -> list[dict] | None:
    """The index's modems list, or None while some package is not stored."""
    out = []
    for g in groups:
        p = known.get(key(g))
        if not p:
            return None
        out.append({"family": p["family"],
                    "package": {k: p[k] for k in ("id", "size", "name", "crc32", "kind")},
                    "devices": g["devices"]})
    return out


def rewrite(index: dict, modems: list[dict]) -> dict | None:
    """The index with its new modem list, or None when nothing changes. Other fields are kept."""
    if index.get("modems") == modems:
        return None
    return {**index, "modems": modems}


def contract(index: dict) -> dict | None:
    """The index without the one-package `baseband` field, or None when it has none.
    Only once every index has `modems` and the site that reads them is live."""
    if "baseband" not in index:
        return None
    if "modems" not in index:
        raise SystemExit(f"{index.get('build')}: no `modems` yet; run the expand pass first")
    return {k: v for k, v in index.items() if k != "baseband"}


def read_meta(d: Path) -> dict[tuple, dict]:
    out = {}
    for f in sorted(d.rglob("*.jsonl")) if d.exists() else []:
        for line in f.read_text().splitlines():
            if line.strip():
                p = json.loads(line)
                out[key(p)] = p
    return out


def read_indexes(d: Path) -> dict[str, dict]:
    out = {}
    for f in sorted(d.glob("*/index.json")):
        if f.stat().st_size:
            out[f.parent.name] = json.loads(f.read_text())
    return out


# ------------------------------------------------------------------ network

def iphone_firmwares() -> tuple[dict[str, list[tuple[str, str]]], dict[str, list[str]]]:
    """build -> [(device, IPSW URL)] for every iPhone ipsw.me knows, and device -> its boards (d93ap)."""
    devices = [d["identifier"] for d in get_json("https://api.ipsw.me/v4/devices") if d["identifier"].startswith("iPhone")]
    out: dict[str, list[tuple[str, str]]] = {}
    boards: dict[str, list[str]] = {}

    def fws(dev):
        return dev, get_json(f"https://api.ipsw.me/v4/device/{dev}?type=ipsw")

    with ThreadPoolExecutor(CONCURRENCY) as ex:
        for dev, d in ex.map(fws, devices):
            for f in d["firmwares"]:
                out.setdefault(f["buildid"], []).append((dev, f["url"]))
            if d.get("boards"):
                boards[dev] = [b["boardconfig"].lower() for b in d["boards"]]
    return out, boards


def appledb_ipsws(build: str) -> list[tuple[str, str]]:
    """Betas: ipsw.me does not list them, AppleDB carries Apple's links."""
    try:
        devs = get_json(f"https://api.appledb.dev/ios/iOS;{build}.json").get("devices") or {}
    except urllib.error.HTTPError:
        return []
    return [(d, v["ipsw"]) for d, v in devs.items() if d.startswith("iPhone") and isinstance(v, dict) and v.get("ipsw")]


def build_groups(builds: list[str]) -> dict[str, list[dict]]:
    fws, boards = iphone_firmwares()
    ipsws: dict[str, dict[str, list[str]]] = {}
    for b in builds:
        pairs = fws.get(b) or appledb_ipsws(b)
        if not pairs:
            print(f"{b}: no iPhone IPSW found", file=sys.stderr)
        for dev, url in pairs:
            ipsws.setdefault(b, {}).setdefault(url, []).append(dev)
    urls = sorted({u for m in ipsws.values() for u in m})

    def listing(url):
        try:
            with open_zip(url) as z:
                return url, modem_members(z.infolist(), plistlib.loads(z.read("BuildManifest.plist")))
        except Exception as e:  # noqa: BLE001
            print(f"{url}: {e}", file=sys.stderr)
            return url, None

    with ThreadPoolExecutor(CONCURRENCY) as ex:
        listings = dict(ex.map(listing, urls))
    out = {}
    for b, by_url in ipsws.items():
        # A build with an unreadable IPSW waits for the next run rather than losing a phone.
        if any(listings[u] is None for u in by_url):
            print(f"{b}: skipped, an IPSW could not be read", file=sys.stderr)
            continue
        out[b] = group(by_url, {u: listings[u] for u in by_url}, boards)
    return out


def fetch(url: str, member: str, size: int, crc32: str, out: Path) -> None:
    """Copy one member out of a remote IPSW; only its bytes are downloaded."""
    with open_zip(url) as z, z.open(member) as src, open(out, "wb") as dst:
        crc, n = 0, 0
        while chunk := src.read(1 << 22):
            crc, n = zlib.crc32(chunk, crc), n + len(chunk)
            dst.write(chunk)
    if n != size or f"{crc:08x}" != crc32:
        raise SystemExit(f"{member}: got {n} bytes crc {crc:08x}, expected {size} crc {crc32}")


# ---------------------------------------------------------------------- cli

def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--indexes", type=Path, required=True)
    p.add_argument("--builds", nargs="*", help="only these builds (default: every held index)")
    p.add_argument("--rebuild", action="store_true", help="re-decode every stored package instead")
    p.add_argument("--legs", type=int, default=6)
    p = sub.add_parser("fetch")
    p.add_argument("--url", required=True)
    p.add_argument("--member", required=True)
    p.add_argument("--size", type=int, required=True)
    p.add_argument("--crc32", required=True)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("write")
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--indexes", type=Path, required=True)
    p.add_argument("--meta", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("contract", help="drop the one-package `baseband` field; prints the builds whose old summary goes")
    p.add_argument("--indexes", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    if a.cmd == "contract":
        for build, index in sorted(read_indexes(a.indexes).items()):
            new = contract(index)
            if not new:
                continue
            dest = a.out / "system" / build / "index.json"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(new, separators=(",", ":")))
            print(build)
        return

    if a.cmd == "fetch":
        fetch(a.url, a.member, a.size, a.crc32, a.out)
        return

    if a.cmd == "plan":
        indexes = read_indexes(a.indexes)
        if a.rebuild:
            out = plan_rebuild(indexes, a.legs)
        else:
            builds = [b for b in (a.builds or sorted(indexes)) if b in indexes]
            out = plan(indexes, build_groups(builds), a.legs)
        n = sum(map(len, out["legs"]))
        print(f"{n} packages to process in {len(out['legs'])} legs, {len(out['builds'])} builds listed", file=sys.stderr)
        print(json.dumps(out, indent=1))
        return

    pl = json.loads(a.plan.read_text())
    indexes = read_indexes(a.indexes)
    known = {**stored(indexes), **read_meta(a.meta)}
    for build, groups in sorted(pl["builds"].items()):
        modems = modems_of(groups, known)
        if modems is None:
            print(f"{build}: not every package is stored, index left alone", file=sys.stderr)
            continue
        new = indexes.get(build) and rewrite(indexes[build], modems)
        if not new:
            continue
        dest = a.out / "system" / build / "index.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(new, separators=(",", ":")))
        print(build)


if __name__ == "__main__":
    main()
