#!/usr/bin/env bash
# Focused regression tests for scripts/post-deploy.sh.
#
# Run with:
#   bash scripts/post-deploy.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

FAKEBIN="$TMPDIR/bin"
mkdir -p "$FAKEBIN"

cat > "$FAKEBIN/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail

cmd="$1 $2"
shift 2

case "$cmd" in
  "ssm get-parameter")
    echo "thinkwork_dev_strands_active"
    ;;
  "bedrock-agentcore-control list-agent-runtimes")
    cat <<'JSON'
{
  "agentRuntimes": [
    {
      "agentRuntimeId": "thinkwork_dev_strands_active",
      "agentRuntimeName": "thinkwork_dev_strands_active",
      "status": "READY"
    },
    {
      "agentRuntimeId": "thinkwork_dev_strands_orphan",
      "agentRuntimeName": "thinkwork_dev_strands_orphan",
      "status": "READY"
    }
  ]
}
JSON
    ;;
  "bedrock-agentcore-control get-agent-runtime")
    runtime_id=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --agent-runtime-id) runtime_id="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ "$runtime_id" == "thinkwork_dev_strands_active" ]]; then
      image_sha="${ACTIVE_IMAGE_SHA:?}"
      version="35"
    else
      image_sha="${ORPHAN_IMAGE_SHA:?}"
      version="1"
    fi
    cat <<JSON
{
  "agentRuntimeVersion": "$version",
  "agentRuntimeArtifact": {
    "containerConfiguration": {
      "containerUri": "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:${image_sha}-arm64"
    }
  }
}
JSON
    ;;
  "bedrock-agentcore-control list-agent-runtime-endpoints")
    runtime_id=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --agent-runtime-id) runtime_id="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ "$runtime_id" == "thinkwork_dev_strands_active" ]]; then
      live="35"
    else
      live="1"
    fi
    cat <<JSON
{
  "runtimeEndpoints": [
    {
      "name": "DEFAULT",
      "status": "READY",
      "liveVersion": "$live",
      "targetVersion": null
    }
  ]
}
JSON
    ;;
  *)
    echo "unexpected aws command: $cmd" >&2
    exit 99
    ;;
esac
AWS
chmod +x "$FAKEBIN/aws"

assert_fails_when_active_runtime_image_is_stale() {
  local source_sha="$1"
  local stale_sha="$2"
  local fresh_sha="$3"

  set +e
  PATH="$FAKEBIN:$PATH" ACTIVE_IMAGE_SHA="$stale_sha" ORPHAN_IMAGE_SHA="$fresh_sha" \
    bash "$ROOT/scripts/post-deploy.sh" --stage dev --region us-east-1 --min-source-sha "$source_sha" --strict \
    >"$TMPDIR/stale.out" 2>"$TMPDIR/stale.err"
  local status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "expected stale active runtime image to fail strict probe" >&2
    cat "$TMPDIR/stale.out" >&2
    exit 1
  fi
  grep -q "does not include required source sha=$source_sha" "$TMPDIR/stale.out"
}

assert_passes_when_active_runtime_image_contains_source() {
  local source_sha="$1"
  local stale_sha="$2"
  local fresh_sha="$3"

  PATH="$FAKEBIN:$PATH" ACTIVE_IMAGE_SHA="$fresh_sha" ORPHAN_IMAGE_SHA="$stale_sha" \
    bash "$ROOT/scripts/post-deploy.sh" --stage dev --region us-east-1 --min-source-sha "$source_sha" --strict \
    >"$TMPDIR/fresh.out" 2>"$TMPDIR/fresh.err"

  grep -q "post-deploy] ok" "$TMPDIR/fresh.out"
}

source_sha="$(git -C "$ROOT" rev-parse b4de57b547ec4e5b596a364aafe0ff8954b0cfa3)"
stale_sha="$(git -C "$ROOT" rev-parse 92fbf1e96861f72153c7cf21942daf6ef3c42ab6)"
fresh_sha="$(git -C "$ROOT" rev-parse HEAD)"

assert_fails_when_active_runtime_image_is_stale "$source_sha" "$stale_sha" "$fresh_sha"
assert_passes_when_active_runtime_image_contains_source "$source_sha" "$stale_sha" "$fresh_sha"

echo "post-deploy tests passed"
