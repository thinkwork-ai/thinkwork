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

# Per `bootstrap-silent-exit-1-set-e-tenant-loop-2026-04-21`: open with an
# ERR trap so a strict-mode kill surfaces a source-located error rather
# than vanishing silently.
trap 'rc=$?; echo "verify-supply-chain: ERR (exit=$rc) on line $LINENO: $BASH_COMMAND" >&2' ERR

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

# Integrity hash format. Baseline + lockfile values must both look like a
# pnpm sha512 hash. A weaker / malformed hash from either side fails the
# check rather than passing as a literal string match.
INTEGRITY_PATTERN='^sha512-[A-Za-z0-9+/=]+$'

verified=0
mismatched=0
missing=0
malformed=0
fail=0

# Read each baseline line. Tolerates spaces or tabs between the columns
# and silently skips comment / blank lines. CRLF handling: the read loop
# strips trailing CR so a Windows-edited baseline doesn't surface as a
# misleading "integrity mismatch" against an apparently-identical hash.
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  # Strip trailing CR (CRLF safety) and surrounding whitespace.
  raw_line="${raw_line%$'\r'}"
  trimmed=$(printf '%s' "$raw_line" | awk '{$1=$1; print}')
  case "$trimmed" in
    "" | \#*) continue ;;
  esac

  # Reject entries that have anything other than exactly two columns. A
  # third column (e.g. an inline `# comment` or a metadata field added by
  # a future contributor) is suspicious — we want a loud error, not silent
  # truncation that drops information the human meant to preserve.
  field_count=$(printf '%s' "$trimmed" | awk '{print NF}')
  if [ "$field_count" -ne 2 ]; then
    echo "verify-supply-chain: malformed baseline entry (expected 2 columns, got $field_count): $raw_line" >&2
    malformed=$((malformed + 1))
    fail=1
    continue
  fi

  pkg_id=$(printf '%s' "$trimmed" | awk '{print $1}')
  expected_integrity=$(printf '%s' "$trimmed" | awk '{print $2}')

  if [ -z "$pkg_id" ] || [ -z "$expected_integrity" ]; then
    echo "verify-supply-chain: malformed baseline entry: $raw_line" >&2
    malformed=$((malformed + 1))
    fail=1
    continue
  fi

  # Reject baseline integrity values that don't match the expected sha512
  # shape. Without this, a lockfile + baseline pair could agree on a
  # weaker hash format (or a hand-rolled placeholder) and pass.
  if ! printf '%s' "$expected_integrity" | grep -Eq "$INTEGRITY_PATTERN"; then
    echo "verify-supply-chain: baseline integrity for $pkg_id is not a sha512- value: $expected_integrity" >&2
    malformed=$((malformed + 1))
    fail=1
    continue
  fi

  # Locate the matching block in pnpm-lock.yaml. We use awk's `index()`
  # rather than `~` so package names containing regex meta-characters
  # (`.`, `+`, `(`, …) match literally. The header lines pnpm emits are
  # `  '<name>@<version>':` (two-space indent) so we anchor on that exact
  # prefix to avoid cross-package false positives.
  header_literal="'${pkg_id}':"
  block=$(awk -v hdr="$header_literal" '
    !found && index($0, hdr) > 0 { found = 1; next }
    found && lines_after < 5 {
      lines_after++
      print
      if (/integrity:/) { exit }
    }
    found && lines_after >= 5 { exit }
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

  # Symmetrically validate the lockfile's integrity value — a malformed
  # field there is just as bad as a malformed baseline entry.
  if ! printf '%s' "$actual_integrity" | grep -Eq "$INTEGRITY_PATTERN"; then
    echo "verify-supply-chain: $pkg_id lockfile integrity is not a sha512- value: $actual_integrity" >&2
    malformed=$((malformed + 1))
    fail=1
    continue
  fi

  if [ "$actual_integrity" = "$expected_integrity" ]; then
    verified=$((verified + 1))
  else
    echo "verify-supply-chain: integrity mismatch for $pkg_id" >&2
    echo "  baseline (len=${#expected_integrity}): $expected_integrity" >&2
    echo "  lockfile (len=${#actual_integrity}): $actual_integrity" >&2
    mismatched=$((mismatched + 1))
    fail=1
  fi
done < "$BASELINE_PATH"

if [ "$fail" -ne 0 ]; then
  echo "verify-supply-chain: FAILED — verified=$verified mismatched=$mismatched missing=$missing malformed=$malformed" >&2
  echo "verify-supply-chain: see docs/solutions/integration-issues/flue-supply-chain-integrity-2026-05-04.md" >&2
  exit 1
fi

if [ "$verified" -eq 0 ]; then
  echo "verify-supply-chain: baseline file has no entries; refusing to pass" >&2
  exit 1
fi

echo "verify-supply-chain: OK — verified $verified package(s) against $LOCKFILE_PATH"
