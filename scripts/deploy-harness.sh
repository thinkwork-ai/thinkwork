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
#   $3 — stage override (default: hp<yymmdd><nnn> — ≤14 chars; longer stage
#        names push Lambda function names past the 64-char AWS cap)
#
# Exit codes: 0 = clean cycle; 1 = one or more steps failed (ledger written);
#             2 = account assertion failed (nothing was deployed or destroyed).

set -u  # no `set -e`: we summarize all failures and always attempt teardown

EXPECTED_ACCOUNT="${1:?usage: deploy-harness.sh <expected-account-id> [region] [stage]}"
REGION="${2:-us-east-1}"
STAGE="${3:-hp$(date +%y%m%d)$(printf '%03d' $((RANDOM % 1000)))}"

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
  # ── Scaffold a scratch stage dir. init + deploy provision the per-account
  #    remote state backend automatically (U2), so cycles converge on rerun. ──
  step "init" bash -c "cd '$STAGE_DIR' && '$CLI' init -s '$STAGE' -d . --defaults"

  # ── Pi image override (cycle-5 ledger entry): the release's ghcr image is
  #    not yet publicly pullable. Until it is, cycles may pass an in-account
  #    image URI; deploy respects an existing tfvars pin over the manifest. ──
  if [ -n "${THINKWORK_PI_IMAGE_URI:-}" ] && [ -f "$TFVARS" ] \
    && ! grep -q '^agentcore_pi_source_image_uri' "$TFVARS"; then
    printf '\nagentcore_pi_source_image_uri = "%s"\n' "$THINKWORK_PI_IMAGE_URI" >>"$TFVARS"
    echo "  Pi image pinned to $THINKWORK_PI_IMAGE_URI (THINKWORK_PI_IMAGE_URI)"
  fi

  # ── Deploy: preflight → apply → artifacts → schema → verify (U3/U9/U10/U6
  #    all run inside deploy; a green deploy IS a verified stack) ─────────────
  step "deploy" bash -c "cd '$STAGE_DIR' && '$CLI' deploy -s '$STAGE' --yes"

  # ── Standalone re-verify (U6): proves `thinkwork verify` agrees from a
  #    cold start, not just as the deploy tail. ───────────────────────────────
  API_SECRET="$(grep -E '^api_auth_secret' "$TFVARS" 2>/dev/null | sed 's/.*= *"\(.*\)"/\1/')"
  step "verify" bash -c "cd '$STAGE_DIR' && '$CLI' verify -s '$STAGE' --api-auth-secret '$API_SECRET'"

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
