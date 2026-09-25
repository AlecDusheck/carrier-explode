#!/usr/bin/env python3
"""
Adds a baseband package to an image already in the bucket, exactly as
package_system_bundles.py does for a new one: blobs/<id>.bbfw, the index
entry, and system/<build>/baseband.json. Used by baseband.yml.

    attach_baseband.py --index system/<build>/index.json --bbfw Mav*.bbfw --baseband baseband.json --out DIR
"""

import argparse
import json
from pathlib import Path

from package_system_bundles import attach_baseband, upload_list


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True, help="the image's current index.json")
    ap.add_argument("--bbfw", type=Path, required=True)
    ap.add_argument("--baseband", type=Path, required=True, help="scripts/baseband.ts output for --bbfw")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    index = json.loads(a.index.read_text())
    files = attach_baseband(index, a.bbfw, a.baseband, a.out)
    # index.json goes up last, so the app never lists a package that is not there yet.
    upload_list(a.out, files[:-1])
    print(f"{index['build']}: {a.bbfw.name} -> {files[0].name}")


if __name__ == "__main__":
    main()
