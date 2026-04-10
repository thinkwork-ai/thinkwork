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

set -euo pipefail

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

# ── 3. Seed per-tenant defaults ──────────────────────────────────────────────
# For each tenant that has agents but missing workspace defaults in S3,
# upload the default files.

echo "── Seeding per-tenant workspace defaults ──"

# Strip sslmode=no-verify (Node.js pg) and replace with sslmode=require (psql-compatible)
PSQL_URL=$(echo "$DATABASE_URL" | sed 's/sslmode=no-verify/sslmode=require/g')
TENANT_SLUGS=$(psql "$PSQL_URL" -t -A -c "SELECT slug FROM tenants" 2>/dev/null || echo "")

if [ -z "$TENANT_SLUGS" ]; then
  echo "  No tenants found (or DB not reachable). Skipping per-tenant seeding."
else
  for slug in $TENANT_SLUGS; do
    DEFAULTS_PREFIX="tenants/$slug/agents/_catalog/defaults/workspace/"

    # Check if defaults already exist
    COUNT=$(aws s3 ls "s3://$BUCKET/$DEFAULTS_PREFIX" 2>/dev/null | wc -l | tr -d ' ')
    # Expect 11 files (4 memory-templates + 4 system-workspace + 3 memory stubs)
    if [ "$COUNT" -ge "11" ]; then
      echo "  ✓ $slug — defaults exist ($COUNT files)"
    else
      echo "  → Seeding defaults for $slug..."
      # Memory templates
      for f in "$REPO_ROOT/packages/memory-templates/"*.md; do
        aws s3 cp "$f" "s3://$BUCKET/${DEFAULTS_PREFIX}$(basename "$f")" --quiet
      done
      # System workspace
      for f in "$REPO_ROOT/packages/system-workspace/"*.md; do
        aws s3 cp "$f" "s3://$BUCKET/${DEFAULTS_PREFIX}$(basename "$f")" --quiet
      done
      # Memory stubs
      echo "# Lessons Learned" | aws s3 cp - "s3://$BUCKET/${DEFAULTS_PREFIX}memory/lessons.md" --quiet
      echo "# Preferences" | aws s3 cp - "s3://$BUCKET/${DEFAULTS_PREFIX}memory/preferences.md" --quiet
      echo "# Contacts" | aws s3 cp - "s3://$BUCKET/${DEFAULTS_PREFIX}memory/contacts.md" --quiet
      echo "  ✓ $slug — seeded"
    fi

    # Copy defaults to any templates missing workspace files
    TEMPLATE_SLUGS=$(psql "$PSQL_URL" -t -A -c "SELECT slug FROM agent_templates WHERE tenant_id = (SELECT id FROM tenants WHERE slug = '$slug')" 2>/dev/null || true)
    for tpl in $TEMPLATE_SLUGS; do
      [ -z "$tpl" ] && continue
      TPL_PREFIX="tenants/$slug/agents/_catalog/$tpl/workspace/"
      TPL_COUNT=$(aws s3 ls "s3://$BUCKET/$TPL_PREFIX" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
      if [ "$TPL_COUNT" -lt "3" ]; then
        echo "  → Copying defaults to template '$tpl'..."
        aws s3 cp --recursive "s3://$BUCKET/$DEFAULTS_PREFIX" "s3://$BUCKET/$TPL_PREFIX" --quiet 2>/dev/null || true
        echo "  ✓ template '$tpl' seeded"
      else
        echo "  ✓ template '$tpl' — workspace exists ($TPL_COUNT files)"
      fi
    done
  done
fi

echo ""
echo "=== Bootstrap complete ==="
