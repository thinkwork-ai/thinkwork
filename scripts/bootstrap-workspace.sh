#!/usr/bin/env bash
# Bootstrap workspace default files and skill catalog for a Thinkwork stage.
#
# Uploads the canonical workspace templates from the repo to S3, syncs the
# skill catalog to the database, and copies defaults to any existing templates
# that are missing workspace files.
#
# Usage:
#   scripts/bootstrap-workspace.sh <stage> <bucket> <database-url>
#
# Example:
#   scripts/bootstrap-workspace.sh dev thinkwork-dev-storage \
#     "postgresql://thinkwork_admin:pass@host:5432/thinkwork?sslmode=no-verify"
#
# Robustness notes:
# - The ERR trap reports line + command before set -e kills the process, so
#   silent failures (e.g. a command substitution with pipefail) surface with
#   a usable source location instead of exit-code-1-with-no-context.
# - The per-tenant seeding loop used to contain `[ … ] && continue` patterns
#   that are technically safe under set -e + pipefail in isolation but become
#   silent gotchas when combined with command substitutions earlier in the
#   iteration. The patterns are now written as explicit `if … then continue`
#   so the intent and the exit-status propagation are both obvious.
# - The seeding block is wrapped in a failure-isolating subshell so a flaky
#   AWS call on one tenant doesn't kill the whole deploy. Individual failures
#   are logged and the final "=== Bootstrap complete ===" line is guaranteed
#   to print.

set -euo pipefail

# Line + command on any set-e kill. Replaces the previous silent-exit-1.
trap 'rc=$?; echo "ERR (exit=$rc) on line $LINENO: $BASH_COMMAND" >&2' ERR

STAGE="${1:?Usage: bootstrap-workspace.sh <stage> <bucket> <database-url>}"
BUCKET="${2:?Usage: bootstrap-workspace.sh <stage> <bucket> <database-url>}"
DATABASE_URL="${3:?Usage: bootstrap-workspace.sh <stage> <bucket> <database-url>}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Thinkwork Workspace Bootstrap ==="
echo "  Stage:  $STAGE"
echo "  Bucket: $BUCKET"
echo ""

# ── 1. Upload workspace default files to S3 ──────────────────────────────────
# These are uploaded to a well-known prefix that ensureDefaultsExist() checks.
# Any tenant's first template creation copies from here.

echo "── Uploading workspace defaults to S3 ──"

# Memory templates
for f in "$REPO_ROOT/packages/memory-templates/"*.md; do
  fname=$(basename "$f")
  aws s3 cp "$f" "s3://$BUCKET/workspace-defaults/$fname" --quiet
  echo "  ✓ $fname"
done

# System workspace
for f in "$REPO_ROOT/packages/system-workspace/"*.md; do
  fname=$(basename "$f")
  aws s3 cp "$f" "s3://$BUCKET/workspace-defaults/$fname" --quiet
  echo "  ✓ $fname"
done

echo ""

# ── 2. Sync skill catalog to database ────────────────────────────────────────

echo "── Syncing skill catalog to database ──"
export DATABASE_URL
cd "$REPO_ROOT"
pnpm -C packages/database-pg exec tsx "$REPO_ROOT/packages/skill-catalog/scripts/sync-catalog-db.ts"
echo ""

# ── 2a. Regenerate workspace maps for every agent ───────────────────────────
# When the catalog adds or retires slugs (e.g. the composition primitives
# deleted in the pure-skill-spec cleanup), existing agents' AGENTS.md files
# still list the old set until someone re-saves their skills. This step
# forces a regen pass so every agent's S3 workspace picks up the new
# canonical skill list on the same deploy that ships the catalog change.
#
# Per-agent failure is caught + logged inside the script; a single bad
# workspace cannot wedge the deploy.

echo "── Regenerating agent workspace maps ──"
pnpm -C packages/api exec tsx "$REPO_ROOT/packages/api/scripts/regen-all-workspace-maps.ts" || true
echo ""

# ── 2b. Upload skill catalog files to S3 ────────────────────────────────────
# Each skill directory (SKILL.md, scripts/, README.md, etc.) is uploaded to
# skills/catalog/<slug>/ so the admin UI can display and edit them, and
# AgentCore can download them at invoke time.
#
# Two exclusion layers:
#
#   1. NON_SKILL_DIRS — top-level directories under packages/skill-catalog/
#      that aren't skills (vitest tests, characterization fixtures, the
#      shared scripts/ dir, node_modules, dev-time tests/). Without these,
#      `aws s3 sync` blindly uploads node_modules (5900+ objects) and
#      dev-only tests into the catalog prefix and the admin UI surfaces
#      them as if they were skills.
#
#   2. PER_SKILL_EXCLUDES — patterns excluded from each per-skill sync,
#      via aws s3 sync --exclude. Drops Python tests/, __tests__, dist,
#      node_modules at the skill level.
#
# The existing --delete flag handles intra-skill cleanup (removing
# files from S3 that no longer exist on disk for a given skill).

NON_SKILL_DIRS=(scripts __tests__ characterization node_modules tests dist)

echo "── Uploading skill catalog files to S3 ──"
for skill_dir in "$REPO_ROOT/packages/skill-catalog"/*/; do
  [ -d "$skill_dir" ] || continue
  slug=$(basename "$skill_dir")

  # Skip top-level non-skill directories (vitest tests, dev-only,
  # workspace artifacts) so they don't get synced as fake skills.
  skip=0
  for non_skill in "${NON_SKILL_DIRS[@]}"; do
    if [ "$slug" = "$non_skill" ]; then
      skip=1
      break
    fi
  done
  if [ "$skip" = "1" ]; then
    continue
  fi

  # --delete so a rewritten SKILL.md doesn't stack stale files on top of the
  # new tree (old prompts/ directories, retired scripts, etc.). The target
  # prefix is slug-scoped, so --delete only affects this slug's objects.
  # --exclude drops dev-only artifacts (Python tests/, vitest __tests__,
  # node_modules) from the per-skill upload so the admin UI doesn't surface
  # them as if they were part of the skill's user-facing surface.
  aws s3 sync "$skill_dir" "s3://$BUCKET/skills/catalog/$slug/" \
    --delete \
    --exclude '*/tests/*' \
    --exclude 'tests/*' \
    --exclude '*/__tests__/*' \
    --exclude '__tests__/*' \
    --exclude '*/__pycache__/*' \
    --exclude '__pycache__/*' \
    --exclude '*/node_modules/*' \
    --exclude 'node_modules/*' \
    --exclude '*/dist/*' \
    --exclude 'dist/*' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    --quiet
  file_count=$(find "$skill_dir" -type f \
    -not -path '*/tests/*' \
    -not -path '*/__tests__/*' \
    -not -path '*/__pycache__/*' \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    | wc -l | tr -d ' ')
  echo "  ✓ $slug ($file_count files)"
done

# ── 2c. Remove retired slugs from S3 ────────────────────────────────────────
# Belt + suspenders: slugs that USED to live in the catalog but were retired
# (composition-era primitives — frame, synthesize, gather, compound;
# thinkwork-admin retired in PR #488; smoke-package-only post-U6) need
# their S3 artifacts cleaned up so the container's install_skill_from_s3
# can't accidentally resurrect them on a warm start, AND so the admin UI
# stops listing them in catalog views. The sync-catalog-db.ts script also
# deletes the matching builtin rows from skill_catalog.
#
# Also purges top-level non-skill prefixes that pre-date the
# NON_SKILL_DIRS exclusion above (one-shot cleanup; idempotent).
RETIRED_SLUGS=(
  frame synthesize gather compound
  thinkwork-admin smoke-package-only
  __tests__ characterization node_modules tests
)
for retired in "${RETIRED_SLUGS[@]}"; do
  aws s3 rm --recursive "s3://$BUCKET/skills/catalog/$retired/" --quiet || true
  echo "  ✗ ${retired} (retired — S3 prefix cleared)"
done
echo ""

# ── 3. Seed per-tenant defaults ──────────────────────────────────────────────
# For each tenant that has agents but missing workspace defaults in S3,
# upload the default files.

echo "── Seeding per-tenant workspace defaults ──"

# Strip sslmode=no-verify (Node.js pg) and replace with sslmode=require (psql-compatible)
PSQL_URL=$(echo "$DATABASE_URL" | sed 's/sslmode=no-verify/sslmode=require/g')
TENANT_SLUGS=$(psql "$PSQL_URL" -t -A -c "SELECT slug FROM tenants" 2>/dev/null || echo "")

# Running the tenant-seed loop in a subshell with its own set-e behavior means
# an error on one tenant logs + skips rather than killing the overall deploy.
# The final "=== Bootstrap complete ===" line is the signal that the step ran
# to completion; any per-tenant warnings appear in-line above it.
bootstrap_status=0
(
  set +e
  if [ -z "$TENANT_SLUGS" ]; then
    echo "  No tenants found (or DB not reachable). Skipping per-tenant seeding."
    exit 0
  fi

  for slug in $TENANT_SLUGS; do
    # Guard against a stray empty slug from a trailing newline in psql output.
    if [ -z "$slug" ]; then
      continue
    fi

    DEFAULTS_PREFIX="tenants/$slug/agents/_catalog/defaults/workspace/"

    # Check if defaults already exist. `aws s3 ls` returns non-zero on an
    # empty prefix in some CLI versions, and with `set -o pipefail` that
    # would kick through `wc -l`. Running without pipefail here is fine —
    # `wc -l` on empty input prints `0`, which is exactly what we want.
    ( set +o pipefail; aws s3 ls "s3://$BUCKET/$DEFAULTS_PREFIX" 2>/dev/null | wc -l | tr -d ' ' ) > /tmp/.bs_count
    COUNT=$(cat /tmp/.bs_count || echo 0)
    rm -f /tmp/.bs_count
    COUNT=${COUNT:-0}

    # Expect 11 files (4 memory-templates + 4 system-workspace + 3 memory stubs)
    if [ "$COUNT" -ge "11" ]; then
      echo "  ✓ $slug — defaults exist ($COUNT files)"
    else
      echo "  → Seeding defaults for $slug..."
      upload_ok=1
      # Memory templates
      for f in "$REPO_ROOT/packages/memory-templates/"*.md; do
        aws s3 cp "$f" "s3://$BUCKET/${DEFAULTS_PREFIX}$(basename "$f")" --quiet || upload_ok=0
      done
      # System workspace
      for f in "$REPO_ROOT/packages/system-workspace/"*.md; do
        aws s3 cp "$f" "s3://$BUCKET/${DEFAULTS_PREFIX}$(basename "$f")" --quiet || upload_ok=0
      done
      # Memory stubs
      echo "# Lessons Learned" | aws s3 cp - "s3://$BUCKET/${DEFAULTS_PREFIX}memory/lessons.md" --quiet || upload_ok=0
      echo "# Preferences" | aws s3 cp - "s3://$BUCKET/${DEFAULTS_PREFIX}memory/preferences.md" --quiet || upload_ok=0
      echo "# Contacts" | aws s3 cp - "s3://$BUCKET/${DEFAULTS_PREFIX}memory/contacts.md" --quiet || upload_ok=0
      if [ "$upload_ok" = "1" ]; then
        echo "  ✓ $slug — seeded"
      else
        echo "  ! $slug — partial failure during seeding (continuing)"
      fi
    fi

    # Copy defaults to any templates missing workspace files.
    TEMPLATE_SLUGS=$(psql "$PSQL_URL" -t -A -c "SELECT slug FROM agent_templates WHERE tenant_id = (SELECT id FROM tenants WHERE slug = '$slug')" 2>/dev/null || true)
    for tpl in $TEMPLATE_SLUGS; do
      if [ -z "$tpl" ]; then
        continue
      fi
      TPL_PREFIX="tenants/$slug/agents/_catalog/$tpl/workspace/"
      ( set +o pipefail; aws s3 ls "s3://$BUCKET/$TPL_PREFIX" 2>/dev/null | wc -l | tr -d ' ' ) > /tmp/.bs_tpl
      TPL_COUNT=$(cat /tmp/.bs_tpl || echo 0)
      rm -f /tmp/.bs_tpl
      TPL_COUNT=${TPL_COUNT:-0}
      if [ "$TPL_COUNT" -lt "3" ]; then
        echo "  → Copying defaults to template '$tpl'..."
        aws s3 cp --recursive "s3://$BUCKET/$DEFAULTS_PREFIX" "s3://$BUCKET/$TPL_PREFIX" --quiet 2>/dev/null || true
        echo "  ✓ template '$tpl' seeded"
      else
        echo "  ✓ template '$tpl' — workspace exists ($TPL_COUNT files)"
      fi
    done
  done
) || bootstrap_status=$?

if [ "$bootstrap_status" -ne 0 ]; then
  echo "  ! Tenant seeding finished with warnings (subshell exit=$bootstrap_status)"
fi

echo ""
echo "=== Bootstrap complete ==="
