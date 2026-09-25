# Shell helpers for the ingest workflows; source it: . scripts/lib.sh
# shellcheck shell=bash

# retry CMD...: run CMD until it succeeds, RETRY_TRIES times at most (default 5),
# backing off 20s, 40s, 80s... with jitter. For idempotent writes: R2's API answers
# 429 under load.
retry() {
  local tries=${RETRY_TRIES:-5} attempt delay
  for (( attempt = 1; ; attempt++ )); do
    "$@" && return 0
    (( attempt < tries )) || return 1
    delay=$(( 10 * 2 ** attempt + RANDOM % 10 ))
    echo "attempt $attempt of $tries failed, retrying in ${delay}s" >&2
    sleep "$delay"
  done
}
