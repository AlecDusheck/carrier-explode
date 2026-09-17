#!/usr/bin/env python3
"""
Turn the bundle directories pulled out of an IPSW into what the app reads from
R2. Bundles are content-addressed, so one that did not change between iOS
releases is stored once and "what changed" is a comparison of two indexes:

    blobs/<sha1>.ipcc               same shape as Apple's OTA .ipcc files
    system/<build>/index.json       name -> {sha1, size, build} per kind
    system/<build>/countries.json   every country carrier.plist, decoded
    system/builds.json              every image held, newest first

    package_system_bundles.py --carriers DIR --countries DIR --meta ipsw_metadata.json \
        --out DIR [--builds existing-builds.json] [--have sha1-list.txt]
"""

import argparse
import hashlib
import json
import plistlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def zip_bundle(bundle: Path, dest: Path) -> None:
    # Fixed timestamps: an unchanged bundle hashes the same on every run.
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(bundle.rglob("*")):
            if f.is_file() and not f.is_symlink():
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
        tmp = blobs / "_tmp.ipcc"
        zip_bundle(b, tmp)
        data = tmp.read_bytes()
        sha1 = hashlib.sha1(data).hexdigest()
        tmp.replace(blobs / f"{sha1}.ipcc")
        build = ""
        try:
            build = str(plistlib.loads((b / "Info.plist").read_bytes()).get("CFBundleVersion", ""))
        except Exception:
            pass
        out[b.stem] = {"sha1": sha1, "size": len(data), "build": build}
    return out


def version_key(v: str) -> list[int]:
    return [int(x) if x.isdigit() else 0 for x in v.split(".")]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--carriers", type=Path, required=True)
    ap.add_argument("--countries", type=Path, required=True)
    ap.add_argument("--meta", type=Path, required=True, help="output of `ipsw info --json`")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--builds", type=Path, help="current system/builds.json, if any")
    ap.add_argument("--have", type=Path, help="sha1s already in the bucket, one per line")
    a = ap.parse_args()

    meta = json.loads(a.meta.read_text())
    device = (meta.get("devices") or [{}])[0]
    index = {
        "version": meta["version"],
        "build": meta["build"],
        "device": device.get("name", ""),
        "product": device.get("product", ""),
        "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "carriers": package(a.carriers, a.out / "blobs"),
        "countries": package(a.countries, a.out / "blobs"),
    }
    sysdir = a.out / "system" / index["build"]
    sysdir.mkdir(parents=True, exist_ok=True)
    (sysdir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    (sysdir / "countries.json").write_text(json.dumps(carrier_plists(a.countries), separators=(",", ":")))

    builds = json.loads(a.builds.read_text()) if a.builds and a.builds.exists() and a.builds.stat().st_size else []
    builds = [b for b in builds if b["build"] != index["build"]]
    builds.append({k: index[k] for k in ("build", "version", "device", "extractedAt")})
    builds.sort(key=lambda b: (version_key(b["version"]), b["build"]), reverse=True)
    (a.out / "builds.json").write_text(json.dumps(builds, separators=(",", ":")))

    # For `wrangler r2 bulk put`. builds.json goes up last, on its own, so the
    # app never lists a half-uploaded image.
    have = set(a.have.read_text().split()) if a.have and a.have.exists() else set()
    files = [p for p in sorted((a.out / "blobs").iterdir()) if p.stem not in have] + sorted(sysdir.iterdir())
    (a.out / "upload.json").write_text(json.dumps(
        [{"key": p.relative_to(a.out).as_posix(), "file": str(p.resolve())} for p in files]))
    print(f"iOS {index['version']} ({index['build']}): {len(index['carriers'])} carrier, "
          f"{len(index['countries'])} country bundles, {len(files)} objects to upload")


if __name__ == "__main__":
    main()
