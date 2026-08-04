#!/usr/bin/env bash
# Focused regression tests for scripts/update-agentcore-runtime-image.sh
# (THINK-584 U5: atomic-or-abort env mirror + never-in-logs secrets).
#
# Run with:
#   bash scripts/update-agentcore-runtime-image.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

FAKEBIN="$TMPDIR/bin"
mkdir -p "$FAKEBIN"

# A fake PEM-shaped secret and API secret. The tests assert these VALUES never
# appear in any output the script produces (R19: never-in-logs).
SECRET_PEM_LINE="MIIFakePemBodyLine000000000000000000000000000000"
SECRET_API="fake-api-auth-secret-value-1234567890"

cat > "$FAKEBIN/aws" <<AWS
#!/usr/bin/env bash
set -euo pipefail

cmd="\$1 \$2"
shift 2

case "\$cmd" in
  "ssm get-parameter")
    echo "thinkwork_dev_pi_active"
    ;;
  "ssm put-parameter")
    exit 0
    ;;
  "lambda get-function-configuration")
    if [[ "\${LAMBDA_ENV_MODE:-full}" == "empty" ]]; then
      echo '{}'
    else
      cat <<'JSON'
{
  "CAPABILITY_SIGNING_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\n${SECRET_PEM_LINE}\n-----END PUBLIC KEY-----",
  "API_AUTH_SECRET": "${SECRET_API}",
  "THINKWORK_API_URL": "https://api.example.test"
}
JSON
    fi
    ;;
  "bedrock-agentcore-control update-agent-runtime")
    echo "update-called" >> "\${CALL_LOG:?}"
    echo '{"version":"36","status":"UPDATING","image":"'"\${EXPECT_IMAGE:?}"'"}'
    ;;
  "bedrock-agentcore-control get-agent-runtime")
    if [[ "\${RUNTIME_ENV_MODE:-full}" == "empty" ]]; then
      env_block='{}'
    else
      env_block='{"API_AUTH_SECRET":"${SECRET_API}","THINKWORK_API_URL":"https://api.example.test"}'
    fi
    cat <<JSON
{
  "agentRuntimeId": "thinkwork_dev_pi_active",
  "status": "READY",
  "agentRuntimeVersion": "36",
  "environmentVariables": \$env_block,
  "agentRuntimeArtifact": {
    "containerConfiguration": {
      "containerUri": "\${EXPECT_IMAGE:?}"
    }
  }
}
JSON
    ;;
  "bedrock-agentcore-control list-agent-runtime-endpoints")
    cat <<'JSON'
{
  "runtimeEndpoints": [
    {
      "name": "DEFAULT",
      "status": "READY",
      "liveVersion": "36",
      "targetVersion": null
    }
  ]
}
JSON
    ;;
  *)
    echo "unexpected aws command: \$cmd" >&2
    exit 99
    ;;
esac
AWS
chmod +x "$FAKEBIN/aws"

IMAGE_URI="487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore@sha256:4444444444444444444444444444444444444444444444444444444444444444"

run_script() {
  PATH="$FAKEBIN:$PATH" EXPECT_IMAGE="$IMAGE_URI" CALL_LOG="$TMPDIR/calls.log" \
    LAMBDA_ENV_MODE="${1:-full}" RUNTIME_ENV_MODE="${2:-full}" \
    bash "$ROOT/scripts/update-agentcore-runtime-image.sh" \
    --stage dev --region us-east-1 --runtime pi \
    --image "$IMAGE_URI" --account-id 487219502366 --wait-seconds 30
}

assert_happy_path_never_logs_secrets() {
  : > "$TMPDIR/calls.log"
  run_script full full >"$TMPDIR/ok.out" 2>"$TMPDIR/ok.err"

  grep -q "update-called" "$TMPDIR/calls.log"
  grep -q "Runtime env assertion OK: " "$TMPDIR/ok.out"
  grep -q "AgentCore runtime ready" "$TMPDIR/ok.out"

  for secret in "$SECRET_PEM_LINE" "$SECRET_API"; do
    if grep -q "$secret" "$TMPDIR/ok.out" "$TMPDIR/ok.err"; then
      echo "secret value leaked into update-agentcore-runtime-image.sh output" >&2
      exit 1
    fi
  done
}

assert_empty_lambda_env_aborts_before_update() {
  : > "$TMPDIR/calls.log"
  set +e
  run_script empty full >"$TMPDIR/empty.out" 2>"$TMPDIR/empty.err"
  local status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "expected empty Lambda env to abort the update" >&2
    exit 1
  fi
  grep -q "empty environment" "$TMPDIR/empty.err"
  if grep -q "update-called" "$TMPDIR/calls.log"; then
    echo "update-agent-runtime was invoked despite an empty env mirror" >&2
    exit 1
  fi
}

assert_empty_runtime_env_after_update_aborts() {
  : > "$TMPDIR/calls.log"
  set +e
  run_script full empty >"$TMPDIR/post.out" 2>"$TMPDIR/post.err"
  local status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "expected empty post-update runtime env to fail the job" >&2
    exit 1
  fi
  grep -q "EMPTY environment after the update" "$TMPDIR/post.err"
}

assert_happy_path_never_logs_secrets
assert_empty_lambda_env_aborts_before_update
assert_empty_runtime_env_after_update_aborts

echo "update-agentcore-runtime-image tests passed"
