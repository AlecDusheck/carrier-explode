#!/usr/bin/env python3
"""
Turn the bundle directories pulled out of an IPSW into what the app reads from
R2. Bundles are keyed by a hash of their contents, so one that did not change
between iOS releases is stored once and "what changed" is a comparison of two
indexes:

    blobs/<id>.ipcc                 same shape as Apple's OTA .ipcc files
    system/<build>/index.json       name -> {id, size, build} per kind; `modems` is filled by scripts/modems.py
    system/<build>/countries.json   every country carrier.plist, decoded
    system/builds.json              every image held, newest first

    package_system_bundles.py --carriers DIR --countries DIR --meta ipsw_metadata.json \
        --out DIR [--builds existing-builds.json] [--have sha1-list.txt] [--version "27.2 beta 2"]
"""

import argparse
import hashlib
import json
import plistlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from versions import merge


# Bump when content_id() changes. The app never compares ids across schemes,
# so a change here shows up as "unknown", not as every bundle having changed.
SCHEME = 1


def bundle_files(bundle: Path) -> list[Path]:
    return sorted((f for f in bundle.rglob("*") if f.is_file() and not f.is_symlink() and f.name != ".DS_Store"),
                  key=lambda f: f.relative_to(bundle).as_posix().encode())


def content_id(bundle: Path) -> str:
    """
    Identity is the files, not the archive: sha256 over "path NUL sha256(bytes) LF"
    for every file in byte order of path. Zip compression, timestamps and entry
    order cannot affect it. src/lib/server/ipcc.ts computes the same value.
    """
    h = hashlib.sha256()
    for f in bundle_files(bundle):
        h.update(f.relative_to(bundle).as_posix().encode() + b"\0" + hashlib.sha256(f.read_bytes()).hexdigest().encode() + b"\n")
    return h.hexdigest()


def zip_bundle(bundle: Path, dest: Path) -> None:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for f in bundle_files(bundle):
            zi = zipfile.ZipInfo(f"Payload/{bundle.name}/{f.relative_to(bundle).as_posix()}", (1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, f.read_bytes())


def json_safe(v):
    """Same tagging the worker's plist decoder uses for binary and dates."""
    if isinstance(v, bytes):
        return {"__data": v.hex(), "__len": len(v)}
    if isinstance(v, datetime):
        return {"__date": v.isoformat()}
    if isinstance(v, dict):
        return {k: json_safe(x) for k, x in v.items()}
    if isinstance(v, list):
        return [json_safe(x) for x in v]
    return v


def carrier_plists(src: Path) -> dict:
    """Every bundle's carrier.plist in one object, so a cross-country table is one read."""
    out = {}
    for b in sorted(p for p in src.iterdir() if p.is_dir() and p.suffix == ".bundle"):
        try:
            out[b.stem] = json_safe(plistlib.loads((b / "carrier.plist").read_bytes()))
        except Exception:
            pass
    return out


def package(src: Path, blobs: Path) -> dict:
    blobs.mkdir(parents=True, exist_ok=True)
    out = {}
    for b in sorted(p for p in src.iterdir() if p.is_dir() and p.suffix == ".bundle"):
        cid = content_id(b)
        dest = blobs / f"{cid}.ipcc"
        if not dest.exists():
            zip_bundle(b, dest)
        build = ""
        try:
            build = str(plistlib.loads((b / "Info.plist").read_bytes()).get("CFBundleVersion", ""))
        except Exception:
            pass
        out[b.stem] = {"id": cid, "size": dest.stat().st_size, "build": build}
    return out


def upload_list(out: Path, files: list[Path]) -> None:
    """For `wrangler r2 bulk put`."""
    (out / "upload.json").write_text(json.dumps(
        [{"key": p.relative_to(out).as_posix(), "file": str(p.resolve())} for p in files]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--carriers", type=Path, required=True)
    ap.add_argument("--countries", type=Path, required=True)
    ap.add_argument("--meta", type=Path, required=True, help="output of `ipsw info --json`")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--builds", type=Path, help="current system/builds.json, if any")
    ap.add_argument("--have", type=Path, help="content ids already in the bucket, one per line")
    ap.add_argument("--version", help="version to record instead of the image's own; a beta image "
                    "says 27.2, and only the planner knows it is 27.2 beta 2")
    a = ap.parse_args()

    meta = json.loads(a.meta.read_text())
    device = (meta.get("devices") or [{}])[0]
    index = {
        "scheme": SCHEME,
        "version": a.version or meta["version"],
        "build": meta["build"],
        "device": device.get("name", ""),
        "product": device.get("product", ""),
        "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "carriers": package(a.carriers, a.out / "blobs"),
        "countries": package(a.countries, a.out / "blobs"),
        "modems": [],
    }
    sysdir = a.out / "system" / index["build"]
    sysdir.mkdir(parents=True, exist_ok=True)
    (sysdir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    (sysdir / "countries.json").write_text(json.dumps(carrier_plists(a.countries), separators=(",", ":")))

    builds = json.loads(a.builds.read_text()) if a.builds and a.builds.exists() and a.builds.stat().st_size else []
    builds = merge([builds, [{k: index[k] for k in ("build", "version", "device", "product", "extractedAt", "scheme")}]])
    (a.out / "builds.json").write_text(json.dumps(builds, separators=(",", ":")))

    # For `wrangler r2 bulk put`. builds.json goes up last, on its own, so the
    # app never lists a half-uploaded image.
    have = set(a.have.read_text().split()) if a.have and a.have.exists() else set()
    files = [p for p in sorted((a.out / "blobs").iterdir()) if p.stem not in have] + sorted(sysdir.iterdir())
    upload_list(a.out, files)
    print(f"iOS {index['version']} ({index['build']}): {len(index['carriers'])} carrier, "
          f"{len(index['countries'])} country bundles, {len(files)} objects to upload")


if __name__ == "__main__":
    main()
