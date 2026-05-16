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
# (`-- creates:` / `-- creates-column:` / `-- creates-extension:` /
# `-- creates-constraint:` / `-- creates-function:` / `-- creates-trigger:`)
# and drop markers (`-- drops:` /
# `-- drops-column:`) and probes the target
# $DATABASE_URL to report APPLIED / MISSING (creates) or DROPPED /
# STILL_PRESENT (drops) per object.
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
#   -- creates-extension: <ext_name>            # probes pg_catalog.pg_extension
#   -- creates-constraint: public.<table_name>.<constraint_name>
#   -- creates-function: public.<function_name>
#   -- creates-trigger: public.<table_name>.<trigger_name>
#   -- creates-role: <role_name>               # probes pg_catalog.pg_roles (global, unqualified)
#   -- drops: public.<table_or_index_name>      # probes ABSENT (DROPPED/STILL_PRESENT)
#   -- drops-column: public.<table_name>.<column_name>     # probes ABSENT
# Multiple markers per file are fine. A file with zero markers is reported
# as UNVERIFIED (explicitly flagged, since "no markers" is a header-quality
# issue that should be fixed at PR time).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRIZZLE_DIR="$REPO_ROOT/packages/database-pg/drizzle"
JOURNAL="$DRIZZLE_DIR/meta/_journal.json"

DRY_RUN=0
# Positional file paths constrain the walk to a specific subset. When empty,
# walk the full DRIZZLE_DIR/*.sql set (original behavior). Paths can be
# absolute, or relative to repo root, or bare basenames — they're resolved
# against DRIZZLE_DIR. Use case: pre-merge CI gates that only want to verify
# the migration(s) the PR changed, not every prior file (which would surface
# pre-existing drift unrelated to the current change).
SCOPED_FILES=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "unknown flag: $arg" >&2
      echo "  try --help" >&2
      exit 2
      ;;
    *)
      # Treat as a positional file path to scope the walk to.
      SCOPED_FILES+=("$arg")
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

probe_column_absent() {
  # Accepts public.table.column — returns DROPPED when the column is absent,
  # STILL_PRESENT when it's still there. Mirror of probe_column for the
  # inverse semantic: a drop migration is "applied" once the column is gone.
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
    echo "DROPPED"
  else
    echo "STILL_PRESENT"
  fi
}

probe_object_absent() {
  # Accepts public.table_or_index_name — returns DROPPED when the relation
  # is absent (the migration applied successfully), STILL_PRESENT when it's
  # still there. Mirror of probe_object for the inverse semantic, mirroring
  # probe_column_absent's drop-then-probe shape. Uses to_regclass like
  # probe_object so it works for both tables and indices.
  local qualified="$1"
  local found
  found=$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('$qualified')::text")
  if [[ -z "$found" ]]; then
    echo "DROPPED"
  else
    echo "STILL_PRESENT"
  fi
}

probe_extension() {
  # Accepts a bare extension name (e.g. aws_s3). Extensions are not schema-
  # qualified in pg_catalog.pg_extension, so the marker form is simpler than
  # creates / creates-column.
  local name="$1"
  local found
  found=$(psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM pg_catalog.pg_extension
     WHERE extname = '$name'
     LIMIT 1
  ")
  if [[ -z "$found" ]]; then
    echo MISSING
  else
    echo "extension:$name"
  fi
}

probe_constraint() {
  # Accepts public.table.constraint. Constraints are schema-qualified through
  # the owning table's namespace rather than being standalone relations.
  local qualified="$1"
  local schema="${qualified%%.*}"
  local rest="${qualified#*.}"
  local tbl="${rest%%.*}"
  local constraint="${rest#*.}"
  local found
  found=$(psql "$DATABASE_URL" -tAc "
    SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = '$schema'
       AND r.relname = '$tbl'
       AND c.conname = '$constraint'
     LIMIT 1
  ")
  if [[ -z "$found" ]]; then
    echo MISSING
  else
    echo "$schema.$tbl.$constraint"
  fi
}

probe_function() {
  # Accepts public.function_name. Assumes no overloaded argument-sensitive
  # verification is needed for migration marker checks.
  local qualified="$1"
  local schema="${qualified%%.*}"
  local function="${qualified#*.}"
  local found
  found=$(psql "$DATABASE_URL" -tAc "
    SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = '$schema'
       AND p.proname = '$function'
     LIMIT 1
  ")
  if [[ -z "$found" ]]; then
    echo MISSING
  else
    echo "$schema.$function"
  fi
}

probe_trigger() {
  # Accepts public.table.trigger.
  local qualified="$1"
  local schema="${qualified%%.*}"
  local rest="${qualified#*.}"
  local tbl="${rest%%.*}"
  local trigger="${rest#*.}"
  local found
  found=$(psql "$DATABASE_URL" -tAc "
    SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class r ON r.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = '$schema'
       AND r.relname = '$tbl'
       AND t.tgname = '$trigger'
       AND NOT t.tgisinternal
     LIMIT 1
  ")
  if [[ -z "$found" ]]; then
    echo MISSING
  else
    echo "$schema.$tbl.$trigger"
  fi
}

probe_role() {
  # Accepts a bare role name (e.g. compliance_writer). Postgres roles are
  # cluster-global, not schema-qualified — the marker form mirrors
  # creates-extension rather than the schema-qualified relation probes.
  local name="$1"
  local found
  found=$(psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = '$name'
     LIMIT 1
  ")
  if [[ -z "$found" ]]; then
    echo MISSING
  else
    echo "role:$name"
  fi
}

any_missing=0
any_unverified=0

# Resolve the file list. SCOPED_FILES (positional args) constrains the walk;
# without args, default to every *.sql in DRIZZLE_DIR.
if [[ ${#SCOPED_FILES[@]} -gt 0 ]]; then
  echo "Unindexed .sql files (scoped to ${#SCOPED_FILES[@]} input paths):"
  WALK_FILES=()
  for raw in "${SCOPED_FILES[@]}"; do
    if [[ -f "$raw" ]]; then
      WALK_FILES+=("$raw")
    elif [[ -f "$DRIZZLE_DIR/$raw" ]]; then
      WALK_FILES+=("$DRIZZLE_DIR/$raw")
    elif [[ -f "$DRIZZLE_DIR/$(basename "$raw")" ]]; then
      WALK_FILES+=("$DRIZZLE_DIR/$(basename "$raw")")
    else
      echo "  warning: $raw not found — skipping" >&2
    fi
  done
else
  echo "Unindexed .sql files in packages/database-pg/drizzle/:"
  WALK_FILES=("$DRIZZLE_DIR"/*.sql)
fi
for f in "${WALK_FILES[@]}"; do
  base="$(basename "$f")"
  # Rollback companions document manual reversal commands. They are not part
  # of the forward drift gate, where their drop markers would be expected to
  # report STILL_PRESENT until an operator intentionally rolls back.
  if [[ "$base" == *_rollback.sql ]]; then
    continue
  fi
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
  ext_markers=$(
    grep -oE "^--[[:space:]]+creates-extension:[[:space:]]+[A-Za-z0-9_]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  constraint_markers=$(
    grep -oE "^--[[:space:]]+creates-constraint:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  function_markers=$(
    grep -oE "^--[[:space:]]+creates-function:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  trigger_markers=$(
    grep -oE "^--[[:space:]]+creates-trigger:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  role_markers=$(
    grep -oE "^--[[:space:]]+creates-role:[[:space:]]+[A-Za-z0-9_]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  drop_col_markers=$(
    grep -oE "^--[[:space:]]+drops-column:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )
  drop_obj_markers=$(
    grep -oE "^--[[:space:]]+drops:[[:space:]]+[A-Za-z0-9_.]+" "$f" 2>/dev/null \
      | awk '{print $NF}' || true
  )

  if [[ -z "$obj_markers" && -z "$col_markers" && -z "$ext_markers" && -z "$constraint_markers" && -z "$function_markers" && -z "$trigger_markers" && -z "$role_markers" && -z "$drop_col_markers" && -z "$drop_obj_markers" ]]; then
    echo "    UNVERIFIED (no '-- creates:', '-- creates-column:', '-- creates-extension:', '-- creates-constraint:', '-- creates-function:', '-- creates-trigger:', '-- creates-role:', '-- drops:', or '-- drops-column:' markers in header)"
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
    if [[ -n "$ext_markers" ]]; then
      while IFS= read -r m; do echo "    creates-extension: $m"; done <<< "$ext_markers"
    fi
    if [[ -n "$constraint_markers" ]]; then
      while IFS= read -r m; do echo "    creates-constraint: $m"; done <<< "$constraint_markers"
    fi
    if [[ -n "$function_markers" ]]; then
      while IFS= read -r m; do echo "    creates-function: $m"; done <<< "$function_markers"
    fi
    if [[ -n "$trigger_markers" ]]; then
      while IFS= read -r m; do echo "    creates-trigger: $m"; done <<< "$trigger_markers"
    fi
    if [[ -n "$role_markers" ]]; then
      while IFS= read -r m; do echo "    creates-role: $m"; done <<< "$role_markers"
    fi
    if [[ -n "$drop_col_markers" ]]; then
      while IFS= read -r m; do echo "    drops-column: $m"; done <<< "$drop_col_markers"
    fi
    if [[ -n "$drop_obj_markers" ]]; then
      while IFS= read -r m; do echo "    drops: $m"; done <<< "$drop_obj_markers"
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
  if [[ -n "$ext_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_extension "$m")
      echo "    extension $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$ext_markers"
  fi
  if [[ -n "$constraint_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_constraint "$m")
      echo "    constraint $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$constraint_markers"
  fi
  if [[ -n "$function_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_function "$m")
      echo "    function $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$function_markers"
  fi
  if [[ -n "$trigger_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_trigger "$m")
      echo "    trigger $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$trigger_markers"
  fi
  if [[ -n "$role_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_role "$m")
      echo "    role $m -> $result"
      [[ "$result" == "MISSING" ]] && any_missing=1
    done <<< "$role_markers"
  fi
  if [[ -n "$drop_col_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_column_absent "$m")
      echo "    drop $m -> $result"
      [[ "$result" == "STILL_PRESENT" ]] && any_missing=1
    done <<< "$drop_col_markers"
  fi
  if [[ -n "$drop_obj_markers" ]]; then
    while IFS= read -r m; do
      [[ -z "$m" ]] && continue
      result=$(probe_object_absent "$m")
      echo "    drop $m -> $result"
      [[ "$result" == "STILL_PRESENT" ]] && any_missing=1
    done <<< "$drop_obj_markers"
  fi
done

# Exit status: 1 if any declared object is missing OR any file lacked markers.
# The "unverified" exit matters because a missing-marker file is a header-
# quality gap the author must fix at PR time.
if [[ $any_missing -ne 0 || $any_unverified -ne 0 ]]; then
  exit 1
fi
exit 0
