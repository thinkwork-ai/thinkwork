#!/usr/bin/env bash
# db-migrate-manual.sh — drift reporter for hand-rolled drizzle migrations.
#
# The repo has two parallel migration tracks in packages/database-pg/drizzle/:
#
#   1. Drizzle-kit auto-tracked files, registered in meta/_journal.json and
#      applied by `pnpm db:push`. Drift-detected by drizzle-kit itself.
#   2. Hand-rolled "apply manually" .sql files that drizzle-kit doesn't know
#      about. No drift detection — until now.
#
# This script walks drizzle/*.sql, excludes files registered in the journal,
# and for each remaining file greps the header for explicit creation markers
# (`-- creates:` / `-- creates-column:`) and probes the target $DATABASE_URL
# to report APPLIED / MISSING per object.
#
# Read-only by default. Does not apply migrations — that stays an operator
# decision via `psql "$DATABASE_URL" -f <file>`. See the companion doc at
# docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-
# from-dev-2026-04-21.md for the full context including the three drift
# incidents that prompted this script.
#
# Usage:
#   DATABASE_URL=postgres://... bash scripts/db-migrate-manual.sh
#   bash scripts/db-migrate-manual.sh --dry-run     # list files + markers, no psql
#   bash scripts/db-migrate-manual.sh --help
#
# Exit codes:
#   0 — every unindexed migration's declared objects are present in the DB.
#   1 — at least one MISSING object (or an unindexed file has no markers).
#   2 — usage / environment error.
#
# Marker convention (declared in each unindexed .sql file's header):
#   -- creates: public.<table_or_index_name>
#   -- creates-column: public.<table_name>.<column_name>
# Multiple markers per file are fine. A file with zero markers is reported
# as UNVERIFIED (explicitly flagged, since "no markers" is a header-quality
# issue that should be fixed at PR time).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRIZZLE_DIR="$REPO_ROOT/packages/database-pg/drizzle"
JOURNAL="$DRIZZLE_DIR/meta/_journal.json"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      echo "  try --help" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$JOURNAL" ]]; then
  echo "journal not found: $JOURNAL" >&2
  exit 2
fi

if [[ "$DRY_RUN" -eq 0 && -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL not set — pass --dry-run to inspect without probing the DB" >&2
  exit 2
fi

# Build the set of journal-registered files. drizzle-kit writes entries with
# `tag` = basename without `.sql`, so we just append `.sql` to match on disk.
# Using a newline-delimited string (not an array) keeps this portable to
# bash 3.x on macOS, which lacks `mapfile`.
INDEXED=$(python3 -c "
import json
with open('$JOURNAL') as f:
    j = json.load(f)
for e in j.get('entries', []):
    print(e['tag'] + '.sql')
")

# Probes. `to_regclass(<name>)` returns NULL when the relation doesn't exist,
# non-NULL otherwise — works for tables, indexes, views, sequences. For
# columns we hit information_schema because to_regclass can't see column-level.
probe_object() {
  local qualified="$1"  # e.g. public.skill_runs
  psql "$DATABASE_URL" -tAc "SELECT COALESCE(to_regclass('$qualified')::text, 'MISSING')"
}

probe_column() {
  # Accepts public.table.column
  local qualified="$1"
  local schema="${qualified%%.*}"
  local rest="${qualified#*.}"
  local tbl="${rest%%.*}"
  local col="${rest#*.}"
  local found
  found=$(psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = '$schema'
       AND table_name   = '$tbl'
       AND column_name  = '$col'
     LIMIT 1
  ")
  if [[ -z "$found" ]]; then
    echo MISSING
  else
    echo "$schema.$tbl.$col"
  fi
}

any_missing=0
any_unverified=0

echo "Unindexed .sql files in packages/database-pg/drizzle/:"
for f in "$DRIZZLE_DIR"/*.sql; do
  base="$(basename "$f")"
  # Skip journal-registered files.
  if printf '%s\n' "$INDEXED" | grep -qx "$base"; then
    continue
  fi

  echo "  $base"

  # Pull markers from the header. Again, newline-delimited strings for
  # bash 3.x portability.
  obj_markers=$(
    grep -oE "^--[[:space:]]+creates:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  col_markers=$(
    grep -oE "^--[[:space:]]+creates-column:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )

  if [[ -z "$obj_markers" && -z "$col_markers" ]]; then
    echo "    UNVERIFIED (no '-- creates:' or '-- creates-column:' markers in header)"
    any_unverified=1
    continue
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ -n "$obj_markers" ]]; then
      while IFS= read -r m; do echo "    creates: $m"; done <<< "$obj_markers"
    fi
    if [[ -n "$col_markers" ]]; then
      while IFS= read -r m; do echo "    creates-column: $m"; done <<< "$col_markers"
    fi
    continue
  fi

  if [[ -n "$obj_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_object "$m")
      echo "    $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$obj_markers"
  fi
  if [[ -n "$col_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_column "$m")
      echo "    $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$col_markers"
  fi
done

# Exit status: 1 if any declared object is missing OR any file lacked markers.
# The "unverified" exit matters because a missing-marker file is a header-
# quality gap the author must fix at PR time.
if [[ $any_missing -ne 0 || $any_unverified -ne 0 ]]; then
  exit 1
fi
exit 0
