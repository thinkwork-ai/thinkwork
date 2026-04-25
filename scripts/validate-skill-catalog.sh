#!/usr/bin/env bash
# validate-skill-catalog.sh — CI validator for skill catalog entries.
#
# Walks packages/skill-catalog/*/SKILL.md and applies the post-2026-04-24-009
# catalog contract:
#
#   * every skill declares execution as one of the supported runtime shapes
#     (currently `script` or `context`) in its SKILL.md frontmatter, OR omits
#     the field (defaults to context per the parser contract). Anything else
#     is rejected as a catalog regression.
#   * tenant-string grep: rejects prompt/template files that contain literal
#     tenant-specific domains or slugs (extend the _TENANT_SIGNALS pattern as
#     the corpus grows).
#
# Plan 2026-04-24-009 retired the parallel skill.yaml metadata file —
# SKILL.md frontmatter is now the canonical source. This validator was
# updated in §U4 to walk frontmatter instead of YAML.
#
# Intended to run in CI on any PR that touches packages/skill-catalog/*. Safe
# to run locally: requires only Python 3.11+ plus PyYAML.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG_DIR="$ROOT/packages/skill-catalog"

if [[ ! -d "$CATALOG_DIR" ]]; then
  echo "skill-catalog directory not found at $CATALOG_DIR — nothing to validate."
  exit 0
fi

errors=0

# --- Supported-execution lint ------------------------------------------------
# Post U6 the runtime supports exactly `script` and `context`. Any other
# execution value is a regression the runtime cannot dispatch.

echo "Checking execution values in SKILL.md frontmatter..."
regressed=()
while IFS= read -r -d '' md; do
  exec_value="$(python3 -c '
import sys, yaml
with open(sys.argv[1]) as f:
    text = f.read()
# Frontmatter shape: leading ---\n...\n---\n. Tolerate files with no
# frontmatter (returns empty dict → execution defaults to context).
if not text.startswith("---\n"):
    print("")
    sys.exit(0)
end = text.find("\n---", 4)
if end == -1:
    print("")
    sys.exit(0)
frontmatter = text[4:end]
data = yaml.safe_load(frontmatter) or {}
print(data.get("execution", ""))
' "$md")"
  # Empty value is OK — defaults to context per the parser contract. We
  # only flag explicit non-{script,context} values as regressions.
  case "$exec_value" in
    script|context|"") ;;
    *)  regressed+=("$md (execution=$exec_value)") ;;
  esac
done < <(find "$CATALOG_DIR" -maxdepth 2 -name SKILL.md -print0)

if [[ ${#regressed[@]} -gt 0 ]]; then
  echo "ERROR: SKILL.md frontmatter declares an unsupported execution type:" >&2
  for entry in "${regressed[@]}"; do
    echo "  $entry" >&2
  done
  echo "The runtime supports only execution=script or execution=context (or omitted, defaults to context)." >&2
  errors=1
fi

# --- Tenant-specific string grep --------------------------------------------
# Intentionally conservative; false negatives are OK, false positives are not.
# Extend this pattern as real tenant slugs/domains surface.

_TENANT_SIGNALS='@homecareintel\.com|@thinkwork\.internal'

echo "Scanning skill-catalog prompts/templates for tenant-specific strings..."
if tenant_hits=$(
  grep -rInE "$_TENANT_SIGNALS" \
    "$CATALOG_DIR" \
    --include='*.md' \
    --include='*.tmpl' \
    2>/dev/null || true
); then
  if [[ -n "$tenant_hits" ]]; then
    echo "ERROR: tenant-specific strings found in skill catalog (these belong in tenant config, not OSS YAML):" >&2
    echo "$tenant_hits" >&2
    errors=1
  fi
fi

# --- Summary ----------------------------------------------------------------

if [[ $errors -ne 0 ]]; then
  echo "validate-skill-catalog: FAILED" >&2
  exit 1
fi

echo "validate-skill-catalog: OK"
exit 0
