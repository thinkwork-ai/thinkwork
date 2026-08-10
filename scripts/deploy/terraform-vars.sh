#!/usr/bin/env bash
# Build the Terraform variable set for a ThinkWork stage deploy.
#
# Sourced (not executed) by the Terraform Apply step of
# .github/workflows/deploy.yml, which both applies and — under the
# `plan_only` dispatch input — plans and stops.
#
# Extracted from that step because 90 lines of -var flags inline in a
# 300-line YAML `run:` block is where drift hides. A standalone plan-only
# *workflow* was tried first and abandoned: these variables depend on
# earlier job steps that write to AWS (Twenty secret creation), so a
# separate read-only workflow could not reproduce them and would have
# reported confidently wrong output — worse than no plan at all.
#
# Inputs arrive as environment variables (the caller maps ${{ secrets.* }}
# and ${{ vars.* }} in its `env:` block) because GitHub context expressions
# cannot be evaluated inside a shell script.
#
# Exports: TF_VAR_ARGS (bash array of -var flags), plus the TF_VAR_* env
# vars that list-typed inputs require.

set -euo pipefail

LAMBDA_DIR=""
if [ -d "${GITHUB_WORKSPACE}/dist/lambdas" ]; then
  LAMBDA_DIR="${GITHUB_WORKSPACE}/dist/lambdas"
fi
PRE_SIGNUP_ZIP=""
if [ -f "$LAMBDA_DIR/cognito-pre-signup.zip" ]; then
  PRE_SIGNUP_ZIP="$LAMBDA_DIR/cognito-pre-signup.zip"
fi
COGNITO_CUSTOM_AUTH_ZIP=""
if [ -f "$LAMBDA_DIR/cognito-custom-auth.zip" ]; then
  COGNITO_CUSTOM_AUTH_ZIP="$LAMBDA_DIR/cognito-custom-auth.zip"
fi
export TF_VAR_db_password="${DB_PASSWORD}"
export TF_VAR_api_auth_secret="${API_AUTH_SECRET}"
export TF_VAR_google_oauth_client_secret="${GOOGLE_OAUTH_CLIENT_SECRET}"
export TF_VAR_microsoft_oauth_client_id="${MICROSOFT_OAUTH_CLIENT_ID}"
export TF_VAR_microsoft_oauth_client_secret="${MICROSOFT_OAUTH_CLIENT_SECRET}"
export TF_VAR_microsoft_oauth_tenant="${MICROSOFT_OAUTH_TENANT}"
export TF_VAR_mapbox_public_token="${MAPBOX_PUBLIC_TOKEN:-}"
# AgentCore managed memory is the only engine (THINK-407). The Hindsight
# infrastructure and the `enable_hindsight` / `memory_engine` selection
# flags are gone; the module inputs survive only as deprecated no-ops.
AUTH_RETIREMENT_PHASE="${AUTH_RETIREMENT_PHASE:-retired}"
AUTH_MIGRATION_RECOVERY_DEADLINE="${AUTH_MIGRATION_RECOVERY_DEADLINE:-}"
if [ "$AUTH_RETIREMENT_PHASE" = "coexistence" ]; then
  if ! [[ "$AUTH_MIGRATION_RECOVERY_DEADLINE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$ ]] || \
    ! date --date="$AUTH_MIGRATION_RECOVERY_DEADLINE" +%s >/dev/null 2>&1; then
    echo "AUTH_MIGRATION_RECOVERY_DEADLINE must be an RFC3339 timestamp while AUTH_RETIREMENT_PHASE=coexistence" >&2
    exit 1
  fi
fi

# External S3 KB source R20: list-typed, so it rides TF_VAR_* env
# (a -var flag would need JSON quotes that bash strips inside the
# array element — "Missing item separator").
#
# Double-quoted, NOT single. Inline in the workflow this read
# '${{ vars.EXTERNAL_KB_SOURCE_ARNS_JSON || '[]' }}', where GitHub
# substitutes before the shell ever sees it, so single quotes were
# right. Here the shell does the expansion, and single quotes would
# export the literal string "${EXTERNAL_KB_SOURCE_ARNS_JSON:-[]}".
export TF_VAR_external_kb_source_arns="${EXTERNAL_KB_SOURCE_ARNS_JSON:-[]}"

TF_VAR_ARGS=(
  -var "stage=${STAGE}"
  -var "region=${AWS_REGION}"
  -var "account_id=${AWS_ACCOUNT_ID}"
  -var "database_engine=aurora-serverless"
  -var "auth_retirement_phase=$AUTH_RETIREMENT_PHASE"
  -var "auth_migration_recovery_deadline=$AUTH_MIGRATION_RECOVERY_DEADLINE"
  -var "twenty_provisioned=$TWENTY_PROVISIONED"
  -var "twenty_runtime_enabled=$TWENTY_RUNTIME_ENABLED"
  -var "twenty_image_uri=$TWENTY_IMAGE_URI"
  -var "twenty_db_username=$TWENTY_DB_USERNAME"
  -var "twenty_db_name=$TWENTY_DB_NAME"
  -var "twenty_db_url_secret_arn=$TWENTY_DB_URL_SECRET_ARN"
  -var "twenty_encryption_key_secret_arn=$TWENTY_ENCRYPTION_KEY_SECRET_ARN"
  -var "twenty_public_url=$TWENTY_PUBLIC_URL"
  -var "twenty_certificate_arn=$TWENTY_CERTIFICATE_ARN"
  -var "n8n_provisioned=$N8N_PROVISIONED"
  -var "n8n_runtime_enabled=$N8N_RUNTIME_ENABLED"
  -var "n8n_image_uri=$N8N_IMAGE_URI"
  -var "n8n_database_admin_secret_arn=$N8N_DATABASE_ADMIN_SECRET_ARN"
  -var "n8n_database_url_secret_arn=$N8N_DATABASE_URL_SECRET_ARN"
  -var "n8n_database_username=$N8N_DB_USERNAME"
  -var "n8n_database_name=$N8N_DB_NAME"
  -var "n8n_encryption_key_secret_arn=$N8N_ENCRYPTION_KEY_SECRET_ARN"
  -var "n8n_operator_secret_arn=$N8N_OPERATOR_SECRET_ARN"
  -var "n8n_service_credential_secret_arn=$N8N_SERVICE_CREDENTIAL_SECRET_ARN"
  -var "n8n_storage_bucket_name=$N8N_STORAGE_BUCKET_NAME"
  -var "n8n_domain=$N8N_DOMAIN"
  -var "n8n_public_url=$N8N_PUBLIC_URL"
  -var "n8n_certificate_arn=$N8N_CERTIFICATE_ARN"
  -var "n8n_container_port=$N8N_CONTAINER_PORT"
  -var "n8n_cache_engine=$N8N_CACHE_ENGINE"
  -var "enable_workspace_orchestration=true"
  -var "wiki_source=${WIKI_SOURCE:-planner}"
  -var "google_oauth_client_id=${GOOGLE_OAUTH_CLIENT_ID}"
  -var "lambda_zips_dir=$LAMBDA_DIR"
  -var "pre_signup_lambda_zip=$PRE_SIGNUP_ZIP"
  -var "cognito_custom_auth_lambda_zip=$COGNITO_CUSTOM_AUTH_ZIP"
  -var "platform_operator_emails=$THINKWORK_PLATFORM_OPERATOR_EMAILS"
  -var "www_domain=${WWW_DOMAIN}"
  -var "cloudflare_zone_id=${CLOUDFLARE_ZONE_ID}"
  -var "ses_inbound_domain=agents.thinkwork.ai"
  -var "ses_parent_domain=thinkwork.ai"
  -var 'tenant_slugs=["academic-bobcat-897","sleek-squirrel-230"]'
  -var "stripe_price_ids_json=${STRIPE_PRICE_IDS_JSON:-{}}"
  -var "agentcore_code_interpreter_id=${AGENTCORE_CODE_INTERPRETER_ID:-}"
  -var "agentcore_memory_id=${AGENTCORE_MEMORY_ID:-}"
  -var "mcp_custom_domain=${MCP_CUSTOM_DOMAIN}"
  -var "mcp_custom_domain_ready=${MCP_CUSTOM_DOMAIN_READY:-false}"
  # Company Brain twin (plan 2026-07-21-001 U5): Neptune wiring for
  # the identity-graph-projector. Values come from the etl-platform
  # neptune stack's outputs (repo vars; empty = twin disabled).
  -var "neptune_endpoint=${NEPTUNE_ENDPOINT:-}"
  # Consolidation U14: platform-served Brain MCP endpoint. When set,
  # twin-connector provisioning registers agents against it instead
  # of the product /mcp/twin route.
  -var "brain_mcp_url=${BRAIN_MCP_URL:-}"
  # THINK-781: Brain ops-api base URL + agent-identity m2m secret for the
  # Send-to-the-Brain flag path. Empty = the action reports "no Brain
  # connection configured".
  -var "brain_ops_api_url=${BRAIN_OPS_API_URL:-}"
  -var "brain_ops_m2m_secret_arn=${BRAIN_OPS_M2M_SECRET_ARN:-}"
  -var "neptune_cluster_resource_id=${NEPTUNE_CLUSTER_RESOURCE_ID:-}"
  -var "neptune_client_security_group_id=${NEPTUNE_CLIENT_SG_ID:-}"
  # Bulk-rebuild lane (THINK-331): loader staging bucket + cluster
  # loader role. Empty = bulk-rebuild returns "not configured".
  # These must accompany neptune_endpoint in EVERY twin-attached
  # stage now that the replay rebuild is retired.
  -var "neptune_load_bucket=${NEPTUNE_LOAD_BUCKET:-}"
  -var "neptune_loader_role_arn=${NEPTUNE_LOADER_ROLE_ARN:-}"
  # Governed autonomy — per-tenant self-extension opt-in allowlist.
  # Empty (default) = NO tenant enabled; the two autonomous actions
  # stay inert and fail-closed. Set via the repo variable so the
  # runtime-config SSM document carries the value durably (a transient
  # `aws ssm put-parameter` override is wiped by the next apply).
  # THINK-280 — capability governed runtime dogfood. deploy.yml is
  # dev-only (STAGE: dev, line ~83); prod/customers deploy via
  # deploy-harness.yml / release.yml where this var is absent (→ false).
  # Brings up the broker (DynamoDB session table, private REST API,
  # DEDICATED execute-api VPCE with private DNS OFF — THINK-144 — never
  # in okf_wiki_interface_endpoint_services, no-NAT interpreter SG) and
  # populates CAPABILITY_PRIVATE_* so agentcore-admin provisions
  # capability-private interpreters. One-line revert disables it.
  -var "enable_capability_broker=true"
  # THINK-643 — dev-only cutover of short-lived auth-flow state (AppSync
  # subscription tickets + the per-principal connect rate-limit counter) from
  # Aurora to DynamoDB. deploy.yml is dev-only; prod/customer stages deploy via
  # deploy-harness.yml / release.yml where this var is absent (→ "postgres",
  # table not provisioned, zero plan diff). Env-overridable so a repo variable
  # can revert dev to Postgres without a code change. The authorizer keeps a
  # permanent Postgres fallback for tickets minted just before a flip.
  -var "auth_state_store=${AUTH_STATE_STORE:-dynamo}"
  # THINK-583 U3 — warm chat path: provisioned concurrency of 1 on the
  # `live` alias of chat-agent-invoke and workspace-renderer (KTD5: never
  # the Pi Lambda). Module defaults stay 0, so this dev-only workflow is
  # the enablement point (deploy.yml is dev-only; customer stages opt in
  # via their runner-secrets tfvars on their own release cadence — same
  # pattern as enable_capability_broker above). Env-overridable so a
  # repo variable can raise/zero it without a code change.
  # THINK-585 U6 — dev-only stage kill-switch for AgentCore Runtime chat
  # dispatch (KTD3). Same enablement pattern as the PC vars above: module
  # default stays false, dev opts in here, customer stages opt in via
  # runner-secrets on their own cadence. The per-agent
  # agents.agentcore_runtime_dispatch flag gates on top, so flipping this
  # alone routes no traffic.
  -var "agentcore_runtime_dispatch_enabled=${AGENTCORE_RUNTIME_DISPATCH_ENABLED:-true}"
  -var "chat_agent_invoke_provisioned_concurrency=${CHAT_AGENT_INVOKE_PROVISIONED_CONCURRENCY:-1}"
  -var "workspace_renderer_provisioned_concurrency=${WORKSPACE_RENDERER_PROVISIONED_CONCURRENCY:-1}"
  # THINK-316 — explicit dev-only managed multiplayer Harness pilot.
  # The default remains off. Production/customer release workflows do
  # not pass these repository variables.
  -var "enable_agentcore_multiplayer_proof=${ENABLE_AGENTCORE_MULTIPLAYER_PROOF:-false}"
  -var "agentcore_multiplayer_proof_tenant_slug=${AGENTCORE_MULTIPLAYER_PROOF_TENANT_SLUG:-}"
  -var "agentcore_multiplayer_proof_owner_allowlist=${AGENTCORE_MULTIPLAYER_PROOF_OWNER_ALLOWLIST:-}"
)
