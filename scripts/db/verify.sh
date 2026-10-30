#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres with a Supabase shim,
# loads the seed, and runs the SQL assertion tests in supabase/tests.
#   npm run db:verify          run and tear down
#   KEEP=1 npm run db:verify   leave the server running (prints the URL)
#   AFTER_CMD='…' npm run db:verify   run a command with $DATABASE_URL before teardown
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${DB_VERIFY_PORT:-55432}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ontriq-db.XXXXXX")"
PGDATA="$WORK/data"
URL="postgresql://postgres@127.0.0.1:${PORT}/ontriq"
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)

cleanup() {
  if [[ "${KEEP:-0}" != "1" ]]; then
    pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

LC_ALL=C LANG=C initdb -D "$PGDATA" -U postgres --auth=trust --no-instructions --encoding=UTF8 --locale=C >/dev/null
LC_ALL=C LANG=C pg_ctl -D "$PGDATA" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/server.log" start -w >/dev/null
psql "postgresql://postgres@127.0.0.1:${PORT}/postgres" -X -q -c "create database ontriq" >/dev/null

echo "• shim"
"${PSQL[@]}" -f supabase/tests/shim/supabase-shim.sql

for f in supabase/migrations/*.sql; do
  echo "• migrate $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -f "$f"
done

if [[ -f supabase/seed.sql ]]; then
  echo "• seed"
  "${PSQL[@]}" -o /dev/null -f supabase/seed.sql
fi

status=0
for t in supabase/tests/*.test.sql; do
  [[ -e "$t" ]] || continue
  echo "• test $(basename "$t")"
  if ! "${PSQL[@]}" -f "$t"; then status=1; fi
done

if [[ $status -eq 0 && -n "${AFTER_CMD:-}" ]]; then
  echo "• after: $AFTER_CMD"
  DATABASE_URL="$URL" bash -c "$AFTER_CMD"
fi

if [[ "${KEEP:-0}" == "1" ]]; then
  echo "Database left running at $URL (data in $WORK). Stop with: pg_ctl -D $PGDATA stop"
fi
if [[ $status -ne 0 ]]; then echo "✗ database tests failed"; exit 1; fi
echo "✓ migrations, seed and tests passed"
