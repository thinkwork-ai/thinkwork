#!/usr/bin/env bash

# Adopt AgentCore capability resources that were proven live before their
# Terraform-bearing commits reached the deployment state. This file is sourced
# by deploy.yml so it can reuse resolve_existing_api_id,
# import_existing_api_route, and TF_VAR_ARGS without making the already-large
# GitHub Actions run expression exceed its 21,000-character limit.

check_lambda_permission_state() {
  local function_name="$1"
  local address="$2"
  local expected_source_arn="$3"
  local state="$4"
  local state_function_name
  local state_principal
  local state_source_arn
  local state_statement_id

  state_function_name=$(awk -F= '$1 ~ /^[[:space:]]*function_name[[:space:]]*$/ { gsub(/[[:space:]"]/, "", $2); print $2; exit }' <<<"$state")
  state_principal=$(awk -F= '$1 ~ /^[[:space:]]*principal[[:space:]]*$/ { gsub(/[[:space:]"]/, "", $2); print $2; exit }' <<<"$state")
  state_source_arn=$(awk -F= '$1 ~ /^[[:space:]]*source_arn[[:space:]]*$/ { gsub(/[[:space:]"]/, "", $2); print $2; exit }' <<<"$state")
  state_statement_id=$(awk -F= '$1 ~ /^[[:space:]]*statement_id[[:space:]]*$/ { gsub(/[[:space:]"]/, "", $2); print $2; exit }' <<<"$state")
  if [ "$state_function_name" = "$function_name" ] \
    && [ "$state_principal" = "apigateway.amazonaws.com" ] \
    && [ "$state_source_arn" = "$expected_source_arn" ] \
    && [ "$state_statement_id" = "AllowAPIGateway" ]; then
    return 0
  fi
  if [ -z "$state_function_name" ] || [ -z "$state_statement_id" ]; then
    echo "::warning::Terraform state for ${address} is malformed; removing it before import."
    terraform state rm "$address"
    return 1
  fi

  echo "::error::Terraform state for ${address} does not match the expected API Gateway permission on ${function_name}."
  echo "::error::Repair the stale Lambda permission state before retrying deploy."
  exit 1
}

import_existing_lambda_permission() {
  local function_name="$1"
  local address="$2"
  local api_id
  local account_id
  local caller_arn
  local partition
  local expected_source_arn
  local state

  api_id=$(resolve_existing_api_id)
  if [ -z "$api_id" ] || [ "$api_id" = "None" ]; then
    echo "No existing API Gateway API found for ${STAGE}; skipping ${function_name} permission import."
    return 0
  fi

  account_id=$(aws sts get-caller-identity --query Account --output text)
  caller_arn=$(aws sts get-caller-identity --query Arn --output text)
  partition=$(cut -d: -f2 <<<"$caller_arn")
  expected_source_arn="arn:${partition}:execute-api:${AWS_REGION}:${account_id}:${api_id}/*/*"

  if state=$(terraform state show "$address" 2>/dev/null); then
    if check_lambda_permission_state "$function_name" "$address" "$expected_source_arn" "$state"; then
      echo "Terraform state already tracks ${function_name}/AllowAPIGateway; skipping import."
      return 0
    fi
  fi

  local live_statement
  live_statement=$(aws lambda get-policy \
    --function-name "$function_name" \
    --output json 2>/dev/null \
    | jq -c --arg sid "AllowAPIGateway" \
      '.Policy | fromjson | [.Statement[]? | select(.Sid == $sid)][0] // empty' \
    || true)
  if [ -z "$live_statement" ]; then
    echo "No existing Lambda permission ${function_name}/AllowAPIGateway; Terraform apply will create it."
    return 0
  fi

  local live_action
  local live_principal
  local live_source_arn
  live_action=$(jq -r '.Action // empty' <<<"$live_statement")
  live_principal=$(jq -r '.Principal.Service // empty' <<<"$live_statement")
  live_source_arn=$(jq -r '.Condition.ArnLike["AWS:SourceArn"] // empty' <<<"$live_statement")
  if [ "$live_action" != "lambda:InvokeFunction" ] \
    || [ "$live_principal" != "apigateway.amazonaws.com" ] \
    || [ "$live_source_arn" != "$expected_source_arn" ]; then
    echo "::error::Live ${function_name}/AllowAPIGateway permission does not match the expected API Gateway principal and source ARN."
    echo "::error::Refusing to import a permission with unexpected authorization semantics."
    exit 1
  fi

  echo "Importing existing Lambda permission ${function_name}/AllowAPIGateway."
  terraform import -input=false -lock-timeout=10m \
    "${TF_VAR_ARGS[@]}" "$address" "${function_name}/AllowAPIGateway"
  state=$(terraform state show "$address")
  check_lambda_permission_state "$function_name" "$address" "$expected_source_arn" "$state"
}

import_existing_api_route \
  "POST /agentcore/capabilities/brain/query" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/brain/query"]'
import_existing_api_route \
  "POST /agentcore/capabilities/email/send" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/email/send"]'
import_existing_api_route \
  "POST /agentcore/capabilities/mcp/tools/call" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/mcp/tools/call"]'
import_existing_api_route \
  "POST /agentcore/capabilities/mcp/tools/list" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/mcp/tools/list"]'
import_existing_api_route \
  "POST /agentcore/capabilities/sandbox/execute" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/sandbox/execute"]'
import_existing_api_route \
  "POST /agentcore/capabilities/web/extract" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/web/extract"]'
import_existing_api_route \
  "POST /agentcore/capabilities/web/search" \
  'module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /agentcore/capabilities/web/search"]'

import_existing_lambda_permission \
  "thinkwork-${STAGE}-api-harness-builtin-tools-target" \
  'module.thinkwork.module.api.aws_lambda_permission.handler_apigw["harness-builtin-tools-target"]'
import_existing_lambda_permission \
  "thinkwork-${STAGE}-api-harness-capability-mcp" \
  'module.thinkwork.module.api.aws_lambda_permission.handler_apigw["harness-capability-mcp"]'
import_existing_lambda_permission \
  "thinkwork-${STAGE}-api-harness-code-interpreter-target" \
  'module.thinkwork.module.api.aws_lambda_permission.handler_apigw["harness-code-interpreter-target"]'
import_existing_lambda_permission \
  "thinkwork-${STAGE}-api-harness-platform-tools-target" \
  'module.thinkwork.module.api.aws_lambda_permission.handler_apigw["harness-platform-tools-target"]'
