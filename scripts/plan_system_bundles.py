#!/usr/bin/env python3
"""
Decide which iOS images the workflow should extract on this run.

Prints a JSON list of {version, build, device} for every release that is newer
than the oldest image already held and not held yet. Asking only for "latest"
would skip a release whenever two ship between runs.

    plan_system_bundles.py --builds builds.json [--device iPhone17,1] [--version 26.4] [--max 3]
"""

import argparse
import json
import urllib.request
from pathlib import Path


def api(path: str):
    req = urllib.request.Request("https://api.ipsw.me/v4" + path, headers={"User-Agent": "carrier-explode"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def vkey(v: str) -> list[int]:
    return [int(x) if x.isdigit() else 0 for x in v.split(".")]


def newest_iphone() -> str:
    ids = [d["identifier"] for d in api("/devices") if d["identifier"].startswith("iPhone")]
    return max(ids, key=lambda i: [int(x) for x in i.removeprefix("iPhone").split(",")])


def plan(held: list[dict], preferred: list[dict], fallback: list[dict], only: str | None, cap: int) -> list[dict]:
    """
    `preferred` and `fallback` are firmware lists ({version, buildid, identifier}).
    The preferred device keeps builds comparable between images; the fallback
    covers releases it no longer receives.
    """
    have = {b["version"] for b in held}
    floor = min((vkey(b["version"]) for b in held), default=None)
    chosen: dict[str, dict] = {}
    for fw in [*fallback, *preferred]:  # preferred last, so it wins
        v = fw["version"]
        if only:
            if v != only:
                continue
        elif v in have or (floor is not None and vkey(v) < floor):
            continue
        chosen[v] = {"version": v, "build": fw["buildid"], "device": fw["identifier"]}
    out = sorted(chosen.values(), key=lambda x: vkey(x["version"]), reverse=True)
    # With nothing held there is no floor: take just the newest rather than all of history.
    if floor is None and not only:
        out = out[:1]
    # Oldest first among the capped set, so history fills in order across runs.
    return sorted(out[:cap] if only else out[-cap:], key=lambda x: vkey(x["version"]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--builds", type=Path, required=True)
    ap.add_argument("--device", default="iPhone17,1")
    ap.add_argument("--version", default="", help="extract exactly this version, held or not")
    ap.add_argument("--max", type=int, default=3)
    a = ap.parse_args()

    held = json.loads(a.builds.read_text() or "[]") if a.builds.exists() else []
    fws = lambda ident: [{**f, "identifier": ident} for f in api(f"/device/{ident}?type=ipsw")["firmwares"]]
    probe = newest_iphone()
    print(json.dumps(plan(held, fws(a.device), fws(probe) if probe != a.device else [], a.version or None, a.max)))


if __name__ == "__main__":
    main()
