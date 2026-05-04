#!/usr/bin/env bash
# Create an AgentCore Runtime for a given SST stage.
#
# Usage:
#   bash scripts/create-runtime.sh --stage main --runtime flue
#   bash scripts/create-runtime.sh --stage ericodom --runtime chat
#
# The --stage flag determines resource names:
#   ECR:  thinkwork-{stage}-agentcore
#   Role: thinkwork-{stage}-agentcore-role
#   SSM:  /thinkwork/{stage}/agentcore/runtime-id-{type}
#
# Prerequisites:
#   - Terraform applied (terraform/modules/app/agentcore-runtime manages ECR + IAM)
#   - Agent container image pushed to ECR (scripts/build-and-push.sh)
set -euo pipefail

STAGE=""
REGION="us-east-1"
RUNTIME_NAME=""
RUNTIME="chat"

while [[ $# -gt 0 ]]; do
  case $1 in
    --stage) STAGE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --runtime-name) RUNTIME_NAME="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$STAGE" ]]; then
  echo "Error: --stage is required (e.g. --stage main or --stage ericodom)"
  exit 1
fi

# Validate runtime type
case "$RUNTIME" in
  chat|code|flue|sdk|strands) ;;
  *)
    echo "Error: --runtime must be 'chat', 'code', 'flue', 'sdk', or 'strands' (got '$RUNTIME')"
    exit 1
    ;;
esac

ACCOUNT_ID="487219502366"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/thinkwork-${STAGE}-agentcore"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/thinkwork-${STAGE}-agentcore-role"
RUNTIME_NAME="${RUNTIME_NAME:-thinkwork-${STAGE}-runtime-${RUNTIME}}"

# Type-specific SSM path
SSM_PATH="/thinkwork/${STAGE}/agentcore/runtime-id-${RUNTIME}"

echo "Creating AgentCore Runtime..."
echo "  Stage:        $STAGE"
echo "  Runtime type: $RUNTIME"
echo "  Name:         $RUNTIME_NAME"
echo "  Image:        ${ECR_URI}:${RUNTIME}-latest"
echo "  Role ARN:     $ROLE_ARN"
echo "  SSM path:     $SSM_PATH"
echo ""

# Create the runtime
RESULT=$(aws bedrock-agentcore-control create-agent-runtime \
  --region "$REGION" \
  --agent-runtime-name "$RUNTIME_NAME" \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:${RUNTIME}-latest\"}}" \
  --role-arn "$ROLE_ARN" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --protocol-configuration '{"serverProtocol":"HTTP"}' \
  --query 'agentRuntimeId' \
  --output text 2>&1) || {
  echo "Error creating runtime: $RESULT"
  echo ""
  echo "If the runtime already exists, update it with:"
  echo "  aws bedrock-agentcore update-agent-runtime --region $REGION --agent-runtime-id <id> ..."
  exit 1
}

RUNTIME_ID="$RESULT"

echo "Runtime created: $RUNTIME_ID"
echo ""

# Store runtime ID in SSM
aws ssm put-parameter \
  --name "$SSM_PATH" \
  --value "$RUNTIME_ID" \
  --type "String" \
  --overwrite \
  --region "$REGION"

echo "Runtime ID stored in SSM: $SSM_PATH"
echo ""
echo "Done! Runtime ID: $RUNTIME_ID"
