#!/usr/bin/env bash
# Plan §005 U10 (FR-3a): supply-chain integrity verification.
#
# pnpm install --frozen-lockfile already enforces lockfile integrity for
# every installed package. This script is the second gate: an explicit
# allow-list of trusted-handler critical-path packages with their pinned
# SHA512 hashes. CI runs this AFTER pnpm install, so a drift here means
# the lockfile itself was rewritten (intentional version bump or supply-
# chain compromise). Either way, the maintainer must explicitly update
# scripts/supply-chain-baseline.txt to acknowledge the change.
#
# Usage:
#   bash scripts/verify-supply-chain.sh [baseline-file] [lockfile]
#
# Defaults:
#   baseline-file = scripts/supply-chain-baseline.txt
#   lockfile      = pnpm-lock.yaml
#
# Both arguments are optional; pass them via env vars instead if useful:
#   SUPPLY_CHAIN_BASELINE=/tmp/test-baseline.txt PNPM_LOCKFILE=pnpm-lock.yaml \
#     bash scripts/verify-supply-chain.sh
#
# Exit codes:
#   0 — all baseline entries match the lockfile
#   1 — at least one mismatch / missing entry / malformed input

set -euo pipefail

BASELINE_PATH="${1:-${SUPPLY_CHAIN_BASELINE:-scripts/supply-chain-baseline.txt}}"
LOCKFILE_PATH="${2:-${PNPM_LOCKFILE:-pnpm-lock.yaml}}"

if [ ! -f "$BASELINE_PATH" ]; then
  echo "verify-supply-chain: baseline file not found: $BASELINE_PATH" >&2
  exit 1
fi
if [ ! -f "$LOCKFILE_PATH" ]; then
  echo "verify-supply-chain: lockfile not found: $LOCKFILE_PATH" >&2
  exit 1
fi

verified=0
mismatched=0
missing=0
fail=0

# Read each baseline line. The pattern intentionally tolerates either spaces
# or tabs between the two columns and silently skips comment / blank lines.
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  # Strip leading/trailing whitespace.
  trimmed=$(printf '%s' "$raw_line" | awk '{$1=$1; print}')
  case "$trimmed" in
    "" | \#*) continue ;;
  esac

  # Split on the first whitespace gap.
  pkg_id=$(printf '%s' "$trimmed" | awk '{print $1}')
  expected_integrity=$(printf '%s' "$trimmed" | awk '{print $2}')

  if [ -z "$pkg_id" ] || [ -z "$expected_integrity" ]; then
    echo "verify-supply-chain: malformed baseline entry: $raw_line" >&2
    fail=1
    continue
  fi

  # Locate the matching block in pnpm-lock.yaml. The lockfile encodes each
  # package as `'<name>@<version>':` followed by a `resolution: { integrity: ... }`
  # line within a couple of lines. We grep for the integrity line in a small
  # window after the header line so a coincidental integrity match elsewhere
  # cannot pass the check.
  header_pattern="'${pkg_id}':"
  block=$(awk -v hdr="$header_pattern" '
    $0 ~ hdr { found=1; next }
    found && NR_after++ < 5 { print; if (NR_after >= 5) exit }
    found && /^[^ ]/ { exit }
  ' "$LOCKFILE_PATH" || true)

  if [ -z "$block" ]; then
    echo "verify-supply-chain: $pkg_id not found in $LOCKFILE_PATH" >&2
    missing=$((missing + 1))
    fail=1
    continue
  fi

  actual_integrity=$(printf '%s\n' "$block" | awk -F'integrity:[[:space:]]*' '
    /integrity:/ { sub(/[}].*/, "", $2); gsub(/[[:space:]]/, "", $2); print $2; exit }
  ')

  if [ -z "$actual_integrity" ]; then
    echo "verify-supply-chain: $pkg_id present but no integrity field within window" >&2
    missing=$((missing + 1))
    fail=1
    continue
  fi

  if [ "$actual_integrity" = "$expected_integrity" ]; then
    verified=$((verified + 1))
  else
    echo "verify-supply-chain: integrity mismatch for $pkg_id" >&2
    echo "  baseline: $expected_integrity" >&2
    echo "  lockfile: $actual_integrity" >&2
    mismatched=$((mismatched + 1))
    fail=1
  fi
done < "$BASELINE_PATH"

if [ "$fail" -ne 0 ]; then
  echo "verify-supply-chain: FAILED — verified=$verified mismatched=$mismatched missing=$missing" >&2
  echo "verify-supply-chain: see docs/solutions/integration-issues/flue-supply-chain-integrity-2026-05-04.md" >&2
  exit 1
fi

if [ "$verified" -eq 0 ]; then
  echo "verify-supply-chain: baseline file has no entries; refusing to pass" >&2
  exit 1
fi

echo "verify-supply-chain: OK — verified $verified package(s) against $LOCKFILE_PATH"
