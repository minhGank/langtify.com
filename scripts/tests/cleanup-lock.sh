#!/bin/sh
# Linux-only kernel-lock regression. No network, credentials or database access.
set -eu
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
/usr/bin/flock --nonblock --conflict-exit-code 75 "$scratch/worker.lock" sh -c 'echo $$ > "$1/owner"; exec sleep 30' sh "$scratch" &
owner=$!
i=0
while [ ! -f "$scratch/owner" ]; do
  i=$((i+1))
  if [ "$i" -gt 100 ]; then kill "$owner"; exit 1; fi
  sleep 0.02
done
set +e
/usr/bin/flock --nonblock --conflict-exit-code 75 "$scratch/worker.lock" sh -c 'touch "$1/overlap"' sh "$scratch"
result=$?
set -e
test "$result" -eq 75
test ! -e "$scratch/overlap"
kill -KILL "$(cat "$scratch/owner")"
set +e
wait "$owner" 2>/dev/null
set -e
/usr/bin/flock --nonblock --conflict-exit-code 75 "$scratch/worker.lock" true
printf '%s\n' 'PASS: overlapping invocation denied; kernel lock released after worker crash'
