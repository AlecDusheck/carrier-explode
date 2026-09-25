#!/usr/bin/env bash
# Stores modem packages and points image indexes at them (scripts/modems.py plans).
# Shared by baseband.yml and the extract job in system-bundles.yml.
#
#   modems.sh indexes DIR               every held system/<build>/index.json into DIR/<build>/
#   modems.sh fetch PLAN LEG META       store each package of plan leg LEG, one line per package into META
#   modems.sh run DIR OUT BUILD         plan, fetch and write one build's modems into OUT/system/BUILD/index.json
#   modems.sh publish OUT               upload OUT/system/*/index.json
#
# Needs BUCKET and wrangler credentials; run from the repo root after pnpm install.
set -euo pipefail

W="${W:-$PWD/node_modules/.bin/wrangler}"
TMP="${RUNNER_TEMP:-/tmp}/modems"
mkdir -p "$TMP"

# R2's API answers 429 under load; every write here is idempotent.
retry() {
  for attempt in 1 2 3 4 5; do
    "$@" && return 0
    [ "$attempt" = 5 ] && return 1
    sleep $(( 10 * 2 ** attempt + RANDOM % 10 ))
  done
}

indexes() {
  local dir=$1
  "$W" r2 object get "$BUCKET/system/builds.json" --remote --pipe > "$TMP/builds.json"
  for b in $(jq -r '.[].build' "$TMP/builds.json"); do
    mkdir -p "$dir/$b"
    retry "$W" r2 object get "$BUCKET/system/$b/index.json" --remote --file "$dir/$b/index.json" > /dev/null
  done
}

# Blob first, then summary; the index that points at them is written after.
fetch() {
  local plan=$1 leg=$2 meta=$3 n failed=0
  n=$(jq ".legs[$leg] | length" "$plan")
  mkdir -p "$(dirname "$meta")"
  for i in $(seq 0 $(( n - 1 ))); do
    local p name kind id f="$TMP/package"
    p=$(jq -c ".legs[$leg][$i]" "$plan")
    name=$(jq -r .name <<< "$p")
    kind=$(jq -r .kind <<< "$p")
    id=$(jq -r '.id // empty' <<< "$p")
    echo "== $name"
    if [ -n "$id" ]; then
      retry "$W" r2 object get "$BUCKET/blobs/$id.$kind" --remote --file "$f" > /dev/null || { failed=1; continue; }
    else
      python3 scripts/modems.py fetch --url "$(jq -r .url <<< "$p")" --member "$(jq -r .member <<< "$p")" \
        --size "$(jq -r .size <<< "$p")" --crc32 "$(jq -r .crc32 <<< "$p")" --out "$f" || { failed=1; continue; }
    fi
    local sha
    sha=$(sha256sum "$f" | cut -d' ' -f1)
    if [ -n "$id" ] && [ "$sha" != "$id" ]; then echo "blobs/$id.$kind hashes to $sha"; failed=1; continue; fi
    npx vite-node scripts/baseband.ts "$f" --name "$name" --out "$TMP/summary.json" < /dev/null || { failed=1; continue; }
    if [ -z "$id" ]; then
      retry "$W" r2 object put "$BUCKET/blobs/$sha.$kind" --file "$f" --remote || { failed=1; continue; }
    fi
    retry "$W" r2 object put "$BUCKET/baseband/$sha.json" --file "$TMP/summary.json" --content-type application/json --remote \
      || { failed=1; continue; }
    jq -c --arg id "$sha" --slurpfile s "$TMP/summary.json" \
      '{name, size, crc32, kind, id: $id, family: $s[0].package.family}' <<< "$p" >> "$meta"
    rm -f "$f"
  done
  return "$failed"
}

run() {
  local dir=$1 out=$2 build=$3
  python3 scripts/modems.py plan --indexes "$dir" --builds "$build" --legs 1 > "$TMP/plan.json"
  rm -rf "$TMP/meta"
  if [ "$(jq '.legs | length' "$TMP/plan.json")" -gt 0 ]; then fetch "$TMP/plan.json" 0 "$TMP/meta/0.jsonl"; fi
  python3 scripts/modems.py write --plan "$TMP/plan.json" --indexes "$dir" --meta "$TMP/meta" --out "$out"
}

publish() {
  local out=$1
  for f in "$out"/system/*/index.json; do
    [ -e "$f" ] || continue
    retry "$W" r2 object put "$BUCKET/system/$(basename "$(dirname "$f")")/index.json" --file "$f" \
      --content-type application/json --remote
  done
}

cmd=${1:-}; shift || true
case "$cmd" in
  indexes|fetch|run|publish) "$cmd" "$@" ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
