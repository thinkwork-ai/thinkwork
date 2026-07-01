#!/usr/bin/env bash
#
# Fresh-deploy acceptance harness (THINK-118).
#
# Cycles a uniquely-named prod-shaped stage through deploy → verify → destroy
# in the target AWS account, using the CLI installed from a packed npm artifact
# (attesting the install channel the README promises, not the repo checkout).
# Every failing step renders a fingerprinted, secret-scrubbed ledger entry for
# posting to THINK-118. Destroy always runs, even after a failure (cleanup-first).
#
# Usage:
#   bash scripts/deploy-harness.sh <expected-account-id> [region] [stage]
#
#   $1 — AWS account ID the run must operate in (asserted before deploy AND destroy)
#   $2 — region (default: us-east-1)
#   $3 — stage override (default: hprod-<yymmdd>-<nnn>)
#
# Exit codes: 0 = clean cycle; 1 = one or more steps failed (ledger written);
#             2 = account assertion failed (nothing was deployed or destroyed).

set -u  # no `set -e`: we summarize all failures and always attempt teardown

EXPECTED_ACCOUNT="${1:?usage: deploy-harness.sh <expected-account-id> [region] [stage]}"
REGION="${2:-us-east-1}"
STAGE="${3:-hprod-$(date +%y%m%d)-$(printf '%03d' $((RANDOM % 1000)))}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/thinkwork-harness.XXXXXX")"
LOGDIR="$WORKDIR/logs"
STAGE_DIR="$WORKDIR/stage"
LEDGER="$ROOT/harness-ledger.json"
LEDGER_HELPER="$ROOT/scripts/lib/harness-ledger.mjs"
TFVARS="$STAGE_DIR/terraform/terraform.tfvars"
mkdir -p "$LOGDIR" "$STAGE_DIR"

PASS=0
FAIL=0
FAILED_STEPS=()

banner() {
  echo ""
  echo "================================================================"
  echo "  thinkwork deploy harness"
  echo "  Stage:   $STAGE"
  echo "  Account: $EXPECTED_ACCOUNT (asserted)"
  echo "  Region:  $REGION"
  echo "  Workdir: $WORKDIR"
  echo "================================================================"
  echo ""
}

# Map a step name to the layer it implicates for the ledger.
layer_for_step() {
  case "$1" in
    pack|install|init) echo "cli" ;;
    deploy|destroy) echo "terraform" ;;
    verify*) echo "stack" ;;
    *) echo "unknown" ;;
  esac
}

ledger_entry() {
  local step_name="$1" log_file="$2"
  node "$LEDGER_HELPER" entry \
    --layer "$(layer_for_step "$step_name")" \
    --step "$step_name" \
    --stage "$STAGE" \
    --log-file "$log_file" \
    --tfvars "$TFVARS" \
    --ledger "$LEDGER"
}

# Run a named step; on failure record it and write a ledger entry.
step() {
  local name="$1"
  shift
  local log_file="$LOGDIR/$name.log"
  printf "  · %-50s " "$name"
  if "$@" >"$log_file" 2>&1; then
    printf "OK\n"
    PASS=$((PASS + 1))
  else
    printf "FAIL\n"
    tail -5 "$log_file" | sed 's/^/      │ /'
    FAIL=$((FAIL + 1))
    FAILED_STEPS+=("$name")
    ledger_entry "$name" "$log_file"
    return 1
  fi
}

assert_account() {
  local context="$1"
  local actual
  actual="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  if [ "$actual" != "$EXPECTED_ACCOUNT" ]; then
    echo "ABORT ($context): caller account '$actual' != expected '$EXPECTED_ACCOUNT'." >&2
    echo "Nothing was ${context}ed. Fix AWS credentials/profile and rerun." >&2
    exit 2
  fi
}

banner
assert_account "deploy"

# ── Install channel: pack the CLI and install into a temp prefix ─────────────
step "pack" bash -c "cd '$ROOT/apps/cli' && pnpm run build && npm pack --pack-destination '$WORKDIR'"
TARBALL="$(ls "$WORKDIR"/thinkwork-cli-*.tgz 2>/dev/null | head -1)"

if [ -n "${TARBALL:-}" ]; then
  step "install" npm install -g --prefix "$WORKDIR/cli-prefix" "$TARBALL"
fi
CLI="$WORKDIR/cli-prefix/bin/thinkwork"

if [ ! -x "$CLI" ]; then
  echo "  Packed CLI unavailable — aborting cycle before any AWS mutation." >&2
  FAIL=$((FAIL + 1))
else
  # ── Scaffold a scratch stage dir (local state is a known U1 limitation; U2
  #    swaps in the per-account injected backend and U8 updates this script) ──
  step "init" bash -c "cd '$STAGE_DIR' && '$CLI' init -s '$STAGE' -d . --defaults"

  # ── Deploy ──────────────────────────────────────────────────────────────────
  step "deploy" bash -c "cd '$STAGE_DIR' && '$CLI' deploy -s '$STAGE' --yes"

  # ── Verify v1: status probes + post-deploy script (replaced by `thinkwork
  #    verify` when U6 lands) ─────────────────────────────────────────────────
  step "verify-status" bash -c "cd '$STAGE_DIR' && '$CLI' status --json | grep -q '$STAGE'"
  if [ -x "$ROOT/scripts/post-deploy.sh" ]; then
    step "verify-post-deploy" bash "$ROOT/scripts/post-deploy.sh" --stage "$STAGE"
  fi

  # ── Teardown (always attempted; account re-asserted) ───────────────────────
  assert_account "destroy"
  step "destroy" bash -c "cd '$STAGE_DIR' && '$CLI' destroy -s '$STAGE' --yes"
fi

echo ""
echo "================================================================"
echo "  Cycle summary: $PASS passed, $FAIL failed  (stage: $STAGE)"
if [ $FAIL -gt 0 ]; then
  echo "  Failed steps:"
  for s in "${FAILED_STEPS[@]}"; do echo "    - $s"; done
  echo "  Ledger: $LEDGER (post new entries to THINK-118 — automated by U8)"
  echo "  Logs:   $LOGDIR"
fi
echo "================================================================"
echo ""

exit "$([ $FAIL -eq 0 ] && echo 0 || echo 1)"
