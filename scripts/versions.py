#!/usr/bin/env python3
"""
iOS version order, betas included: 27.2 beta 3 < 27.2 RC < 27.2 < 27.2.1.
src/lib/names.ts orders them the same way.

    versions.py merge builds.json [more.json ...]   # union by build, newest first
"""

import json
import re
import sys

PRERELEASE = re.compile(r"^(.*?)\s+(beta|rc)\s*(\d*)$", re.I)


def version_key(v: str) -> tuple:
    m = PRERELEASE.match(v)
    nums = [int(x) if x.isdigit() else 0 for x in (m.group(1) if m else v).split(".")]
    # Trailing zeros do not count: 27.0 and 27 are one version.
    while len(nums) > 1 and nums[-1] == 0:
        nums.pop()
    rank = 1_000_000 if not m else (1000 if m.group(2).lower() == "rc" else 0) + int(m.group(3) or 0)
    return (nums, rank)


def is_prerelease(v: str) -> bool:
    return bool(PRERELEASE.match(v))


def merge(lists: list[list[dict]]) -> list[dict]:
    """Later lists win for a build they share."""
    by = {b["build"]: b for bs in lists for b in bs}
    return sorted(by.values(), key=lambda b: (version_key(b["version"]), b["build"]), reverse=True)


if __name__ == "__main__":
    if sys.argv[1:2] != ["merge"]:
        sys.exit(__doc__)
    lists = []
    for path in sys.argv[2:]:
        with open(path) as f:
            text = f.read().strip()
        lists.append(json.loads(text) if text else [])
    print(json.dumps(merge(lists), separators=(",", ":")))
