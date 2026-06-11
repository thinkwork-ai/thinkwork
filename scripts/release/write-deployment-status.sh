#!/usr/bin/env bash
# Write the canonical deployment status pointer consumed by Settings > General.
#
# Usage:
#   write-deployment-status.sh --stage dev --bucket <evidence-bucket> \
#     --release-version v0.1.0-canary.165 --manifest-url <url> \
#     --manifest-sha256 <sha256>

set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: write-deployment-status.sh --stage <stage> --bucket <bucket> --release-version <version> [options]

Required:
  --stage <stage>
  --bucket <deployment evidence bucket>
  --release-version <version>

Options:
  --manifest-url <url>
  --manifest-sha256 <sha256>
  --commit <git sha>
  --source <source>                      default: github-actions
  --status <status>                      default: succeeded
  --state-machine-arn <arn>
  --runner-project-name <name>
  --github-repository <owner/repo>
  --github-run-id <id>
  --github-run-at <iso timestamp>
  --github-run-attempt <attempt>
  --github-ref <ref>
  --github-workflow <workflow>
  --github-actor <actor>
  --dry-run                              print JSON instead of uploading to S3
EOF
}

stage=""
bucket=""
release_version=""
manifest_url=""
manifest_sha256=""
commit_sha=""
source_name="github-actions"
status="succeeded"
state_machine_arn=""
runner_project_name=""
github_repository="${GITHUB_REPOSITORY:-}"
github_run_id="${GITHUB_RUN_ID:-}"
github_run_at=""
github_run_attempt="${GITHUB_RUN_ATTEMPT:-}"
github_ref="${GITHUB_REF:-}"
github_workflow="${GITHUB_WORKFLOW:-}"
github_actor="${GITHUB_ACTOR:-}"
dry_run=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) stage="${2:-}"; shift 2 ;;
    --bucket) bucket="${2:-}"; shift 2 ;;
    --release-version) release_version="${2:-}"; shift 2 ;;
    --manifest-url) manifest_url="${2:-}"; shift 2 ;;
    --manifest-sha256) manifest_sha256="${2:-}"; shift 2 ;;
    --commit) commit_sha="${2:-}"; shift 2 ;;
    --source) source_name="${2:-}"; shift 2 ;;
    --status) status="${2:-}"; shift 2 ;;
    --state-machine-arn) state_machine_arn="${2:-}"; shift 2 ;;
    --runner-project-name) runner_project_name="${2:-}"; shift 2 ;;
    --github-repository) github_repository="${2:-}"; shift 2 ;;
    --github-run-id) github_run_id="${2:-}"; shift 2 ;;
    --github-run-at) github_run_at="${2:-}"; shift 2 ;;
    --github-run-attempt) github_run_attempt="${2:-}"; shift 2 ;;
    --github-ref) github_ref="${2:-}"; shift 2 ;;
    --github-workflow) github_workflow="${2:-}"; shift 2 ;;
    --github-actor) github_actor="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 64 ;;
  esac
done

if [[ -z "$stage" || -z "$release_version" ]]; then
  usage
  exit 64
fi

if [[ "$dry_run" != "true" && -z "$bucket" ]]; then
  usage
  exit 64
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to write deployment status" >&2
  exit 69
fi

updated_at="${github_run_at:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
run_key="${github_run_id:-manual}"
safe_updated_at="$(printf '%s' "$updated_at" | tr -c 'A-Za-z0-9._-' '-')"
history_key="deployment/status/history/${safe_updated_at}-${run_key}.json"
current_key="deployment/status/current.json"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

jq -n \
  --arg schemaVersion "1" \
  --arg stage "$stage" \
  --arg status "$status" \
  --arg source "$source_name" \
  --arg updatedAt "$updated_at" \
  --arg releaseVersion "$release_version" \
  --arg manifestUrl "$manifest_url" \
  --arg manifestSha256 "$manifest_sha256" \
  --arg commitSha "$commit_sha" \
  --arg evidenceBucketName "$bucket" \
  --arg stateMachineArn "$state_machine_arn" \
  --arg codebuildProjectName "$runner_project_name" \
  --arg githubRepository "$github_repository" \
  --arg githubRunId "$github_run_id" \
  --arg githubRunAttempt "$github_run_attempt" \
  --arg githubRef "$github_ref" \
  --arg githubWorkflow "$github_workflow" \
  --arg githubActor "$github_actor" \
  '
  def maybe($key; $value): if $value == "" then {} else {($key): $value} end;
  {
    schemaVersion: ($schemaVersion | tonumber),
    stage: $stage,
    status: $status,
    source: $source,
    updatedAt: $updatedAt,
    activeRelease: (
      {version: $releaseVersion}
      + maybe("manifestUrl"; $manifestUrl)
      + maybe("manifestSha256"; $manifestSha256)
      + maybe("commitSha"; $commitSha)
    ),
    controller: (
      maybe("evidenceBucketName"; $evidenceBucketName)
      + maybe("stateMachineArn"; $stateMachineArn)
      + maybe("codebuildProjectName"; $codebuildProjectName)
    ),
    github: (
      maybe("repository"; $githubRepository)
      + maybe("runId"; $githubRunId)
      + maybe("runAttempt"; $githubRunAttempt)
      + maybe("ref"; $githubRef)
      + maybe("workflow"; $githubWorkflow)
      + maybe("actor"; $githubActor)
    )
  }
  ' > "$tmp_file"

if [[ "$dry_run" == "true" ]]; then
  cat "$tmp_file"
  exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is required to upload deployment status" >&2
  exit 69
fi

aws s3 cp "$tmp_file" "s3://${bucket}/${history_key}" \
  --content-type application/json \
  --cache-control no-store
aws s3 cp "$tmp_file" "s3://${bucket}/${current_key}" \
  --content-type application/json \
  --cache-control no-store

echo "Wrote deployment status:"
echo "  s3://${bucket}/${current_key}"
echo "  s3://${bucket}/${history_key}"
