#!/usr/bin/env python3
"""
Decide which iOS images the workflow should extract on this run.

Prints a JSON list of {version, build, device} for every release that is newer
than the floor (--since, else the oldest image held) and not held yet. Asking only for "latest"
would skip a release whenever two ship between runs.

Betas come after the releases: every beta newer than the newest public release
that is not held yet, as {version: "27.2 beta 2", build, device, url, beta: true}.
ipsw.me does not list betas, so they come from AppleDB, which carries Apple's own
IPSW links for them. A beta for a release that has already shipped is not
fetched: the point is to see bundle changes before they reach phones.

    plan_system_bundles.py --builds builds.json [--device iPhone17,1] [--version 26.4] [--max 3]

--baseband-have FILE instead lists every held build whose build id is not in
FILE (one per line), as {version, build, device, url}, for backfilling
system/<build>/baseband.json; the URL is ipsw.me's, else AppleDB's for betas.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

from versions import version_key


def api(path: str):
    req = urllib.request.Request("https://api.ipsw.me/v4" + path, headers={"User-Agent": "carrier-explode"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def newest_iphone() -> str:
    ids = [d["identifier"] for d in api("/devices") if d["identifier"].startswith("iPhone")]
    return max(ids, key=lambda i: [int(x) for x in i.removeprefix("iPhone").split(",")])


def plan(held: list[dict], preferred: list[dict], fallback: list[dict],
         only: str | None, since: str | None, cap: int) -> list[dict]:
    """
    `preferred` and `fallback` are firmware lists ({version, buildid, identifier}).
    The preferred device keeps builds comparable between images; the fallback
    covers releases it no longer receives.

    A release is its build, not its version: Apple sometimes re-issues a version
    under a new build. The exception is a version we hold from a different
    device, whose build number differs for that reason alone.
    """
    builds = {b.get("build") for b in held}
    held_from = {b["version"]: b.get("product") for b in held}
    floor = version_key(since) if since else min((version_key(b["version"]) for b in held), default=None)

    chosen: dict[str, dict] = {}
    for fw in [*fallback, *preferred]:  # preferred last, so it wins
        v, device = fw["version"], fw["identifier"]
        if only:
            if v != only:
                continue
        else:
            if fw["buildid"] in builds or (floor is not None and version_key(v) < floor):
                continue
            if v in held_from and held_from[v] not in (None, device):
                continue
        chosen[v] = {"version": v, "build": fw["buildid"], "device": device}

    out = sorted(chosen.values(), key=lambda x: version_key(x["version"]))
    # No floor at all: take just the newest rather than all of history.
    if floor is None and not only:
        return out[-1:]
    # Oldest first, so history fills in order across runs.
    return out[:cap]


# 24B5089g: build 24, train B, and a lowercase suffix because it is a beta.
BETA_BUILD = re.compile(r"^(\d+)([A-Z])\d+[a-z]$")
RELEASE_BUILD = re.compile(r"^(\d+)([A-Z])\d+$")


def train(build: str) -> tuple[int, str] | None:
    m = BETA_BUILD.match(build) or RELEASE_BUILD.match(build)
    return (int(m.group(1)), m.group(2)) if m else None


def beta_candidates(keys: list[str], held: list[dict], releases: list[dict]) -> list[str]:
    """
    Beta builds in AppleDB's index worth a closer look: not held, and on a later
    train than the newest public release (24B5089g is past 24A437, so it is a
    beta of what comes next). Cheap, so each run fetches only a handful.
    """
    have = {b.get("build") for b in held}
    newest = max((train(f["buildid"]) for f in releases if train(f["buildid"])), default=None)
    out = []
    for k in keys:
        os_, _, build = k.partition(";")
        if os_ != "iOS" or not BETA_BUILD.match(build) or build in have:
            continue
        if newest is None or train(build) > newest:
            out.append(build)
    return out


def plan_betas(entries: list[dict], device: str, cap: int) -> list[dict]:
    """`entries` are AppleDB firmware records. Prefer `device`, else the newest iPhone the beta has."""
    out = []
    for e in entries:
        if not e.get("beta"):
            continue
        ipsws = {d: v["ipsw"] for d, v in (e.get("devices") or {}).items()
                 if d.startswith("iPhone") and isinstance(v, dict) and v.get("ipsw")}
        if not ipsws:
            continue
        pick = device if device in ipsws else max(ipsws, key=lambda i: [int(x) for x in i.removeprefix("iPhone").split(",")])
        out.append({"version": e["version"], "build": e["build"], "device": pick, "url": ipsws[pick], "beta": True})
    out.sort(key=lambda x: version_key(x["version"]))
    return out[:cap]


def missing_baseband(held: list[dict], have: set[str]) -> list[dict]:
    """Held images without a baseband.json, newest first (builds.json order), from the device they were taken from."""
    return [{"version": b["version"], "build": b["build"], "device": b.get("product") or ""}
            for b in held if b.get("build") and b["build"] not in have]


def ipsw_url(device: str, build: str) -> str | None:
    """Apple's IPSW link for this device and build: ipsw.me for releases, AppleDB for betas."""
    try:
        return api(f"/ipsw/{device}/{build}")["url"]
    except Exception:  # noqa: BLE001
        pass
    try:
        devices = appledb(f"iOS;{build}.json").get("devices") or {}
        return (devices.get(device) or {}).get("ipsw")
    except Exception:  # noqa: BLE001
        return None


def appledb(path: str):
    req = urllib.request.Request("https://api.appledb.dev/ios/" + path, headers={"User-Agent": "carrier-explode"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--builds", type=Path, required=True)
    ap.add_argument("--device", default="iPhone17,1")
    ap.add_argument("--version", default="", help="extract exactly this version, held or not")
    ap.add_argument("--since", default="", help="extract everything from this version up (default: oldest held)")
    ap.add_argument("--max", type=int, default=3)
    ap.add_argument("--no-betas", dest="betas", action="store_false", help="releases only")
    ap.add_argument("--baseband-have", type=Path, help="builds that already have baseband.json; list the rest")
    a = ap.parse_args()

    held = json.loads(a.builds.read_text() or "[]") if a.builds.exists() else []
    if a.baseband_have:
        have = set(a.baseband_have.read_text().split()) if a.baseband_have.exists() else set()
        out = []
        for b in missing_baseband(held, have):
            url = ipsw_url(b["device"], b["build"])
            if url:
                out.append({**b, "url": url})
            else:
                print(f"no IPSW URL for {b['device']} {b['build']}", file=sys.stderr)
        print(json.dumps(out))
        return
    fws = lambda ident: [{**f, "identifier": ident} for f in api(f"/device/{ident}?type=ipsw")["firmwares"]]
    probe = newest_iphone()
    preferred, fallback = fws(a.device), (fws(probe) if probe != a.device else [])
    out = plan(held, preferred, fallback, a.version or None, a.since or None, a.max)

    # Not when one version was asked for. --since is only a floor for releases
    # (MIN_VERSION fills it on every run), and betas are above it anyway.
    # AppleDB being down never costs a release.
    if not a.version and a.betas and len(out) < a.max:
        try:
            builds = beta_candidates(appledb("index.json"), held, [*preferred, *fallback])
            out += plan_betas([appledb(f"iOS;{b}.json") for b in builds], a.device, a.max - len(out))
        except Exception as e:  # noqa: BLE001
            print(f"betas skipped: {e}", file=sys.stderr)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
