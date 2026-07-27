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
# The deprecated graph memory path is disabled for all deploys.
# Hindsight is the authoritative user and Space memory engine.
MEMORY_ENGINE="hindsight"
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
  -var "enable_hindsight=true"
  -var "memory_engine=$MEMORY_ENGINE"
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
  -var "hindsight_database_name=${HINDSIGHT_DATABASE_NAME:-}"
  -var "knowledge_graph_observations_ingest_enabled=${WIKI_KG_INGEST_ENABLED:-false}"
  -var "ontology_scan_sweep_enabled=${ONTOLOGY_SCAN_SWEEP_ENABLED:-false}"
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
  -var "analyst_policy_source=${ANALYST_POLICY_SOURCE:-row}"
  # Company Brain twin (plan 2026-07-21-001 U5): Neptune wiring for
  # the identity-graph-projector. Values come from the etl-platform
  # neptune stack's outputs (repo vars; empty = twin disabled).
  -var "neptune_endpoint=${NEPTUNE_ENDPOINT:-}"
  # Consolidation U14: platform-served Brain MCP endpoint. When set,
  # twin-connector provisioning registers agents against it instead
  # of the product /mcp/twin route.
  -var "brain_mcp_url=${BRAIN_MCP_URL:-}"
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
  -var "capability_self_extension_tenants=${CAPABILITY_SELF_EXTENSION_TENANTS:-}"
  # THINK-280 — capability governed runtime dogfood. deploy.yml is
  # dev-only (STAGE: dev, line ~83); prod/customers deploy via
  # deploy-harness.yml / release.yml where this var is absent (→ false).
  # Brings up the broker (DynamoDB session table, private REST API,
  # DEDICATED execute-api VPCE with private DNS OFF — THINK-144 — never
  # in okf_wiki_interface_endpoint_services, no-NAT interpreter SG) and
  # populates CAPABILITY_PRIVATE_* so agentcore-admin provisions
  # capability-private interpreters. One-line revert disables it.
  -var "enable_capability_broker=true"
  # THINK-316 — explicit dev-only managed multiplayer Harness pilot.
  # The default remains off. Production/customer release workflows do
  # not pass these repository variables.
  -var "enable_agentcore_multiplayer_proof=${ENABLE_AGENTCORE_MULTIPLAYER_PROOF:-false}"
  -var "agentcore_multiplayer_proof_tenant_slug=${AGENTCORE_MULTIPLAYER_PROOF_TENANT_SLUG:-}"
  -var "agentcore_multiplayer_proof_owner_allowlist=${AGENTCORE_MULTIPLAYER_PROOF_OWNER_ALLOWLIST:-}"
)
