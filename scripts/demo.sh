#!/usr/bin/env bash
# Everything a demo needs on this Mac: the database stack, the built app and
# the job worker, with the Mac kept awake. Ctrl+C stops it all.
#
#   npm run demo             start, using the data already there
#   npm run demo -- --reset  wipe the local data and build the demo data again
#
# Local stack only. Sign-ins are written to demo-logins.local.md.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3100
DB=postgresql://postgres@127.0.0.1:55433/ontriq
export APP_ORIGIN="http://localhost:$PORT"
reset=false
[[ "${1:-}" == "--reset" ]] && reset=true

trap 'trap - EXIT INT TERM; kill 0' EXIT INT TERM

# iCloud can take files off this disk, and a file it took has to come back
# before anything can read it. Bring them all back now, not mid-demo.
echo "• Checking iCloud hasn't removed project files"
find . -path ./node_modules -prune -o -path ./.next -prune -o -type f -flags +dataless -print0 2>/dev/null |
  xargs -0 -n 1 -P 12 sh -c 'cat "$0" > /dev/null 2>&1' || true

[[ -f .next/BUILD_ID ]] || npm run build

echo "• Starting the database"
if $reset; then npm run stack:local -- --reset & else npm run stack:local & fi
until nc -z 127.0.0.1 54321 2>/dev/null; do sleep 1; done

if $reset; then
  echo "• Building the demo data"
  rm -f "$HOME/.ontiq/local-stack/dev-users.json"
  # Sign-in with a password alone, so nobody needs an authenticator during the demo.
  psql "$DB" -q -c "update public.orgs set mfa_required_for_staff = false"
  npx tsx scripts/seed-demo.ts --env .env.local --db-url "$DB" --app "$APP_ORIGIN" --logins demo-logins.local.md
  # The sample companies from the development seed don't belong in a demo.
  psql "$DB" -q -c "delete from public.clients c where c.notes is distinct from '' and c.code in ('HEMAS', 'CEYFIN') and not exists (select 1 from public.cases k where k.client_id = c.id)" || true
fi

echo "• Starting the app"
npx next start -p "$PORT" &
npx tsx --env-file=.env.local scripts/worker-local.ts --watch --every 5 &
caffeinate -dimsu -w $$ &

until curl -s -o /dev/null "http://localhost:$PORT/login"; do sleep 1; done
echo
echo "Ontriq is running at http://localhost:$PORT/login"
echo "Sign-ins are in demo-logins.local.md. Keep this window open. Ctrl+C stops everything."
wait
