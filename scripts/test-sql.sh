#!/usr/bin/env bash
# ============================================================
# Fit Squad — run the migrations against a real PostgreSQL.
#
# Creates a throwaway cluster in a temp directory, loads shim.sql (the parts
# of Supabase that are not Postgres), then schema.sql, then EVERY migration
# in order, then supabase/tests/*_test.sql. Deletes the cluster afterwards.
# It never touches your Supabase project and never needs the network.
#
# What it catches that `npm test` cannot:
#   - a migration that does not apply on a clean database,
#   - a migration that does not apply after the ones before it,
#   - a function that returns the wrong thing, which until now was only
#     discoverable by deploying and looking at the app.
#
# Postgres is optional. Without it this exits 0 with a notice, so it can sit
# in `npm run deploy` without becoming a thing you have to install to ship.
#   macOS:  brew install postgresql@16
#   Debian: sudo apt-get install postgresql
# ============================================================
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The server binaries are not on PATH on either platform by default.
for candidate in \
  "$(command -v pg_ctl 2>/dev/null || true)" \
  /usr/lib/postgresql/*/bin/pg_ctl \
  /opt/homebrew/opt/postgresql@16/bin/pg_ctl \
  /usr/local/opt/postgresql@16/bin/pg_ctl \
  /opt/homebrew/bin/pg_ctl \
  /Applications/Postgres.app/Contents/Versions/*/bin/pg_ctl
do
  if [ -n "${candidate:-}" ] && [ -x "$candidate" ]; then PGBIN="$(dirname "$candidate")"; break; fi
done

if [ -z "${PGBIN:-}" ] || ! command -v psql >/dev/null 2>&1; then
  echo "→ SQL tests skipped: no local PostgreSQL found."
  echo "  Install one to have the migrations checked before you deploy:"
  echo "    macOS   brew install postgresql@16"
  echo "    Debian  sudo apt-get install postgresql"
  exit 0
fi

tmp="$(mktemp -d)"
# A high port so a Postgres you already run locally is untouched, and a unix
# socket inside the temp dir so this cannot collide with anything.
port=54329
data="$tmp/data"
db=fitsquad_test

cleanup() {
  "$PGBIN/pg_ctl" -D "$data" -s -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# initdb refuses to run as root, which is exactly the case in a container.
run_pg() {
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    su postgres -c "$1"
  else
    bash -c "$1"
  fi
}
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  chown -R postgres "$tmp"
fi

echo "→ starting a throwaway PostgreSQL on port $port"
run_pg "'$PGBIN/initdb' -D '$data' -U postgres --auth=trust" >"$tmp/initdb.log" 2>&1 \
  || { echo "initdb failed:"; tail -20 "$tmp/initdb.log"; exit 1; }
run_pg "'$PGBIN/pg_ctl' -D '$data' -o '-k $tmp -p $port -c listen_addresses=' -l '$tmp/server.log' -w start" \
  >/dev/null 2>&1 || { echo "postgres failed to start:"; tail -20 "$tmp/server.log"; exit 1; }

psql() { command psql -h "$tmp" -p "$port" -U postgres "$@"; }
psql -q -c "create database $db" postgres

load() {
  local file="$1"
  if ! out="$(psql -q -v ON_ERROR_STOP=1 -f "$file" "$db" 2>&1)"; then
    echo "✗ $(basename "$file")"
    echo "$out" | grep -v '^NOTICE' | head -20
    exit 1
  fi
  echo "  ✓ $(basename "$file")"
}

echo "→ schema"
load "$root/supabase/tests/shim.sql"
load "$root/supabase/schema.sql"

echo "→ migrations, in order"
for f in "$root"/supabase/migrations/0*.sql; do load "$f"; done

echo "→ tests"
for f in "$root"/supabase/tests/*_test.sql; do load "$f"; done

echo "✓ SQL: schema, $(ls "$root"/supabase/migrations/0*.sql | wc -l | tr -d ' ') migrations and the function tests all pass on a clean database."
