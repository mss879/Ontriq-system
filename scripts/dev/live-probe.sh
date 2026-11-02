#!/bin/bash
# Public timings of the live site from this machine, needing no sign-in: what
# each layer costs on a reused connection, the first visit to a route, and what
# happens when requests overlap (a second function instance starting cold).
#
#   bash scripts/dev/live-probe.sh [https://ontriq-system.netlify.app]
set -u
BASE=${1:-https://ontriq-system.netlify.app}

js=$(curl -s -m 20 "$BASE/login" | grep -oE '/_next/static/chunks/[A-Za-z0-9_.-]+\.js' | head -1)

# Times from a dozen requests over one connection, skipping the first two.
layer() {
  local label=$1 url=$2 args=() i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do args+=(-o /dev/null "$url"); done
  curl -s -m 90 -H 'Accept-Encoding: br' -w '%{time_starttransfer}\n' "${args[@]}" | tail -n +3 | sort -n | awk -v label="$label" '
    { ms[NR] = $1 * 1000 }
    END { printf "%-32s median %4d ms   max %4d ms\n", label, ms[int((NR + 1) / 2)], ms[NR] }'
}

echo "Layers, one reused connection"
layer "CDN static file" "$BASE$js"
layer "Edge proxy, no session" "$BASE/api/nope"
layer "Function, no database" "$BASE/api/jobs/tick"
layer "Function, 2 database reads" "$BASE/api/health"
layer "Page render, no database" "$BASE/login"

echo
echo "First visit to a route, then repeats (ms, the first includes connection setup)"
for route in /c/expired /setup /verify/00000000-0000-0000-0000-000000000000; do
  args=(); for i in 1 2 3 4; do args+=(-o /dev/null "$BASE$route"); done
  printf "%-46s" "$route"
  curl -s -m 60 -H 'Accept-Encoding: br' -w '%{time_starttransfer}\n' "${args[@]}" | awk '{ printf "%d ", $1 * 1000 } END { print "" }'
done

echo
echo "Six requests at once to /login (ms to first byte, slowest last)"
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -m 30 -w '%{time_starttransfer}\n' "$BASE/login" &
done | sort -n | awk '{ printf "%d ", $1 * 1000 } END { print "" }'
wait
