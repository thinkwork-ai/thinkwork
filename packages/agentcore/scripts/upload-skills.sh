#!/usr/bin/env bash
# Upload skills to S3 AgentCoreFilesBucket.
# Usage:
#   ./upload-skills.sh my-bucket-name       # explicit bucket name
#   AGENTCORE_FILES_BUCKET=my-bucket ./upload-skills.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/../skills"
PREFIX="skills/v1/"

# Resolve bucket name: argument > env var > SSM parameter
BUCKET="${1:-${AGENTCORE_FILES_BUCKET:-}}"

if [ -z "$BUCKET" ]; then
  STAGE="${STAGE:-ericodom}"
  echo "Resolving bucket name from SSM (/thinkwork/${STAGE}/workspace-bucket-name)..."
  BUCKET=$(aws ssm get-parameter --name "/thinkwork/${STAGE}/workspace-bucket-name" --query 'Parameter.Value' --output text --region us-east-1 2>/dev/null || true)
fi

if [ -z "$BUCKET" ]; then
  echo "Error: No bucket specified. Pass bucket name as argument or set AGENTCORE_FILES_BUCKET env var."
  exit 1
fi

echo "Syncing skills to s3://$BUCKET/$PREFIX"
echo "  Source: $SKILLS_DIR"

aws s3 sync "$SKILLS_DIR" "s3://$BUCKET/${PREFIX}" \
  --delete \
  --exclude ".*" \
  --exclude "*.DS_Store"

echo "Done. Skills uploaded to s3://$BUCKET/${PREFIX}"
aws s3 ls "s3://$BUCKET/${PREFIX}" --recursive
