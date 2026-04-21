#!/usr/bin/env bash
# validate-skill-catalog.sh — CI validator for composition-mode skills.
#
# Walks packages/skill-catalog/*/skill.yaml and, for each skill declared as
# `execution: composition`, validates the YAML against the Pydantic schema in
# packages/agentcore-strands/agent-container/skill_inputs.py.
#
# Exits non-zero with a list of offending files on any validation error. Also
# runs two supplementary lints:
#   * tenant-string grep: rejects prompt/template files that contain literal
#     tenant-specific domains or slugs (extend the _TENANT_SIGNALS pattern as
#     the corpus grows).
#   * no-blocking-sleep lint: rejects `asyncio.sleep` and `time.sleep` calls
#     inside any script file that lives under a composition-mode skill
#     directory. The reconciler contract requires composition sub-skills to
#     be non-blocking.
#
# Intended to run in CI on any PR that touches packages/skill-catalog/*. Safe
# to run locally: requires only `uv` plus Python 3.11+.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG_DIR="$ROOT/packages/skill-catalog"
CONTAINER_DIR="$ROOT/packages/agentcore-strands/agent-container"

if [[ ! -d "$CATALOG_DIR" ]]; then
  echo "skill-catalog directory not found at $CATALOG_DIR — nothing to validate."
  exit 0
fi

errors=0

# --- Pydantic schema validation for composition skills -----------------------

composition_yamls=()
while IFS= read -r -d '' yaml; do
  if grep -q '^execution: composition' "$yaml" 2>/dev/null; then
    composition_yamls+=("$yaml")
  fi
done < <(find "$CATALOG_DIR" -maxdepth 2 -name skill.yaml -print0)

if [[ ${#composition_yamls[@]} -gt 0 ]]; then
  echo "Validating ${#composition_yamls[@]} composition skill(s)..."

  # Run all schemas through a single uv-backed Python invocation for speed.
  if ! uv run --no-project --with 'pydantic>=2.0' --with 'PyYAML>=6.0' \
    python - "${composition_yamls[@]}" <<'PY'
import sys
sys.path.insert(0, "packages/agentcore-strands/agent-container")
from skill_inputs import validate_composition_file  # noqa: E402

failed = 0
for path in sys.argv[1:]:
    ok, errs = validate_composition_file(path)
    if ok:
        print(f"  OK  {path}")
    else:
        failed += 1
        for err in errs:
            print(f"  ERR {err}", file=sys.stderr)

sys.exit(1 if failed else 0)
PY
  then
    errors=1
  fi
else
  echo "No composition skills found — skipping schema validation."
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
    --include='*.yaml' \
    2>/dev/null || true
); then
  if [[ -n "$tenant_hits" ]]; then
    echo "ERROR: tenant-specific strings found in skill catalog (these belong in tenant config, not OSS YAML):" >&2
    echo "$tenant_hits" >&2
    errors=1
  fi
fi

# --- No-blocking-sleep lint for composition sub-skills -----------------------
# Sub-skills invoked by a composition must not block on external events.
# Composition directories are identified by execution: composition in skill.yaml;
# we then scan every *.py file under that directory (and under any referenced
# sub-skills/ subdir) for asyncio.sleep / time.sleep.

echo "Scanning composition sub-skills for blocking sleeps..."
for yaml in "${composition_yamls[@]:-}"; do
  [[ -z "$yaml" ]] && continue
  comp_dir="$(dirname "$yaml")"
  if sleep_hits=$(
    grep -rInE '\b(asyncio\.sleep|time\.sleep)\b' \
      "$comp_dir" --include='*.py' 2>/dev/null || true
  ); then
    if [[ -n "$sleep_hits" ]]; then
      echo "ERROR: blocking sleep(s) found in composition $comp_dir — violates reconciler contract:" >&2
      echo "$sleep_hits" >&2
      errors=1
    fi
  fi
done

# --- Summary ----------------------------------------------------------------

if [[ $errors -ne 0 ]]; then
  echo "validate-skill-catalog: FAILED" >&2
  exit 1
fi

echo "validate-skill-catalog: OK"
exit 0
