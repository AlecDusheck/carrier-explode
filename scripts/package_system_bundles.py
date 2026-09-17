#!/usr/bin/env python3
"""
Turn the bundle directories pulled out of an IPSW into what the worker reads
from R2: one .ipcc per bundle (same shape as Apple's CDN ones, so the existing
decoder needs no changes) plus an index.json.

    package_system_bundles.py --carriers DIR --countries DIR --meta ipsw_metadata.json --out DIR
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


def package(src: Path, kind: str, out: Path) -> list[dict]:
    dest_dir = out / kind
    dest_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for b in sorted(p for p in src.iterdir() if p.is_dir() and p.suffix == ".bundle"):
        dest = dest_dir / f"{b.stem}.ipcc"
        zip_bundle(b, dest)
        data = dest.read_bytes()
        build = ""
        try:
            build = str(plistlib.loads((b / "Info.plist").read_bytes()).get("CFBundleVersion", ""))
        except Exception:
            pass
        rows.append({"name": b.stem, "size": len(data), "sha1": hashlib.sha1(data).hexdigest(), "build": build})
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--carriers", type=Path, required=True)
    ap.add_argument("--countries", type=Path, required=True)
    ap.add_argument("--meta", type=Path, required=True, help="output of `ipsw info --json`")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    meta = json.loads(a.meta.read_text())
    device = (meta.get("devices") or [{}])[0]
    index = {
        "version": meta["version"],
        "build": meta["build"],
        "device": device.get("name", ""),
        "product": device.get("product", ""),
        "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "carriers": package(a.carriers, "carriers", a.out),
        "countries": package(a.countries, "countries", a.out),
    }
    (a.out / "countries.json").write_text(json.dumps(carrier_plists(a.countries), separators=(",", ":")))
    (a.out / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"iOS {index['version']} ({index['build']}): "
          f"{len(index['carriers'])} carrier, {len(index['countries'])} country bundles")


if __name__ == "__main__":
    main()
