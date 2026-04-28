################################################################################
# Real Lambda Handlers
#
# Each handler is bundled by scripts/build-lambdas.sh into dist/lambdas/<name>.zip.
# Terraform references them via var.lambda_zips_dir (local path) for dev deploys,
# or via S3 (lambda_artifact_bucket) for production.
################################################################################

locals {
  use_local_zips = var.lambda_zips_dir != ""
  runtime        = "nodejs20.x"

  # Common environment variables shared by all API handlers
  common_env = {
    STAGE                       = var.stage
    DATABASE_URL                = "postgresql://${var.db_username}:${urlencode(var.db_password)}@${var.db_cluster_endpoint}:5432/${var.database_name}?sslmode=no-verify"
    DATABASE_SECRET_ARN         = var.graphql_db_secret_arn
    DATABASE_HOST               = var.db_cluster_endpoint
    DATABASE_NAME               = var.database_name
    BUCKET_NAME                 = var.bucket_name
    USER_POOL_ID                = var.user_pool_id
    COGNITO_USER_POOL_ID        = var.user_pool_id
    ADMIN_CLIENT_ID             = var.admin_client_id
    MOBILE_CLIENT_ID            = var.mobile_client_id
    COGNITO_MCP_CLIENT_ID       = aws_cognito_user_pool_client.mcp_oauth.id
    COGNITO_AUTH_BASE_URL       = local.mcp_oauth_cognito_base_url
    MCP_OAUTH_CALLBACK_URL      = "${local.mcp_oauth_api_base_url}/mcp/oauth/callback"
    MCP_OAUTH_REVOCATIONS_TABLE = aws_dynamodb_table.mcp_oauth_revocations.name
    COGNITO_APP_CLIENT_IDS      = "${var.admin_client_id},${var.mobile_client_id}"
    APPSYNC_ENDPOINT            = var.appsync_api_url
    APPSYNC_API_KEY             = var.appsync_api_key
    GRAPHQL_API_KEY             = var.appsync_api_key
    API_AUTH_SECRET             = var.api_auth_secret
    THINKWORK_API_SECRET        = var.api_auth_secret
    EMAIL_HMAC_SECRET           = var.api_auth_secret
    THINKWORK_API_URL           = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com"
    # Comma-separated allowlist of caller emails permitted to invoke
    # operator-gated mutations (updateTenantPolicy, sandbox fixture
    # setup, etc.). Resolved against ctx.auth.email, which is pulled
    # from the Cognito JWT for user callers and from the
    # `x-principal-email` header for service-auth callers (see
    # packages/api/src/lib/cognito-auth.ts). Empty ⇒ the gate
    # rejects every call, which is the safe default pre-rollout.
    THINKWORK_PLATFORM_OPERATOR_EMAILS = var.platform_operator_emails
    AGENTCORE_FUNCTION_NAME            = var.agentcore_function_name
    AGENTCORE_PI_FUNCTION_NAME         = var.agentcore_pi_function_name
    WORKSPACE_BUCKET                   = var.bucket_name
    HINDSIGHT_ENDPOINT                 = var.hindsight_endpoint
    AGENTCORE_MEMORY_ID                = var.agentcore_memory_id
    MEMORY_ENGINE                      = var.memory_engine
    # Skip the SSM indirection for cross-function ARN lookup. Terraform
    # already knows this ARN at apply time and the Lambda role's SSM
    # permission has been a recurring source of silent failures where
    # getChatAgentInvokeFnArn falls back to null and sendMessage loses
    # message_history on the wakeup-processor fallback path.
    CHAT_AGENT_INVOKE_FN_ARN = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-chat-agent-invoke"
    ADMIN_URL                = var.admin_url
    DOCS_URL                 = var.docs_url
    APPSYNC_REALTIME_URL     = var.appsync_realtime_url
    ECR_REPOSITORY_URL       = var.ecr_repository_url
    AWS_ACCOUNT_ID           = var.account_id
    NODE_OPTIONS             = "--enable-source-maps"
    # Per-user OAuth wiring (Google Workspace today; Microsoft 365 follow-up).
    # Secret ARNs are the indirection; the actual client_id/client_secret
    # values live in Secrets Manager and are fetched by
    # packages/api/src/lib/oauth-client-credentials.ts at cold-start.
    # OAUTH_CALLBACK_URL is the URL registered with Google/Azure OAuth apps.
    # REDIRECT_SUCCESS_URL is the fallback post-OAuth redirect when the
    # caller doesn't pass a per-request returnUrl (mobile passes thinkwork://).
    GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN = aws_secretsmanager_secret.oauth_google_productivity.arn
    OAUTH_CALLBACK_URL                   = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com/api/oauth/callback"
    REDIRECT_SUCCESS_URL                 = var.redirect_success_url

    # Stripe billing — see stripe-secrets.tf. The ARN is the indirection;
    # the actual keys live in Secrets Manager and are fetched by
    # packages/api/src/lib/stripe-credentials.ts at cold-start. Price IDs
    # are non-secret per-stage config carried as a plain JSON env var so
    # staging/prod can use different products without a secret rotation.
    STRIPE_CREDENTIALS_SECRET_ARN = aws_secretsmanager_secret.stripe_api_credentials.arn
    STRIPE_PRICE_IDS_JSON         = var.stripe_price_ids_json
    STRIPE_CHECKOUT_SUCCESS_URL   = "${var.admin_url}/onboarding/welcome?session_id={CHECKOUT_SESSION_ID}"
    STRIPE_CHECKOUT_CANCEL_URL    = "${var.www_url}/cloud"
    WWW_URL                       = var.www_url
    # Override the welcome email's From: address. Defaults to
    # hello@agents.thinkwork.ai (the already-verified SES inbound domain);
    # set to hello@thinkwork.ai once the bare-apex identity is verified in SES.
    STRIPE_WELCOME_FROM_EMAIL = var.stripe_welcome_from_email
  }

  # Per-handler env-var overrides. ARNs are constructed from the naming
  # pattern (same trick as lambda_api_cross_invoke in main.tf) so we don't
  # introduce a self-referential dependency inside the handler for_each.
  handler_extra_env = {
    "job-schedule-manager" = {
      JOB_TRIGGER_ARN      = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger"
      JOB_TRIGGER_ROLE_ARN = var.job_scheduler_role_arn
    }
    # Compounding Memory compile Lambda. Any Converse-compatible Bedrock
    # model works; the planner + section-writer cap themselves at ~500
    # records / 25 new pages per invocation so a 480 s timeout covers
    # the worst case comfortably. Env vars come from variables so
    # unrelated deploys don't wipe them back to defaults (the aggregation
    # flag got reset on every terraform apply before this was pinned).
    "wiki-compile" = {
      BEDROCK_MODEL_ID                   = var.wiki_compile_model_id
      WIKI_AGGREGATION_PASS_ENABLED      = var.wiki_aggregation_pass_enabled
      WIKI_DETERMINISTIC_LINKING_ENABLED = var.wiki_deterministic_linking_enabled
      # Name (not value) of the SecureString SSM parameter that holds the
      # Google Places API key. wiki-compile fetches + caches on cold start.
      # The parameter may contain a placeholder value at apply time — the
      # Lambda logs and degrades gracefully if decryption returns empty.
      GOOGLE_PLACES_SSM_PARAM_NAME = "/thinkwork/${var.stage}/google-places/api-key"
    }
    "wiki-export" = {
      WIKI_EXPORT_BUCKET = aws_s3_bucket.wiki_exports.bucket
    }
  }
}

# ---------------------------------------------------------------------------
# Helper: creates a Lambda function from a local zip
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "handler" {
  for_each = local.use_local_zips ? toset([
    "graphql-http",
    "chat-agent-invoke",
    "wakeup-processor",
    "workspace-event-dispatcher",
    "agents",
    "agent-actions",
    "messages",
    "connections",
    "oauth-authorize",
    "oauth-callback",
    "stripe-checkout",
    "stripe-webhook",
    "stripe-portal",
    "stripe-subscription",
    "auth-me",
    "teams",
    "team-members",
    "tenants",
    "users",
    "invites",
    "skills",
    "mcp-oauth",
    "mcp-user-memory",
    "activity",
    "routines",
    "budgets",
    "guardrails",
    "scheduled-jobs",
    "activation",
    "activation-apply-worker",
    "job-schedule-manager",
    "job-trigger",
    "webhooks",
    "webhooks-admin",
    "webhook-deliveries-cleanup",
    "skill-runs-reconciler",
    "webhook-crm-opportunity",
    "webhook-task-event",
    "workspace-files",
    "knowledge-base-manager",
    "knowledge-base-files",
    "email-send",
    "email-inbound",
    "github-app",
    "github-repos",
    "memory",
    "memory-retain",
    "wiki-compile",
    "wiki-lint",
    "wiki-export",
    "wiki-bootstrap-import",
    "artifact-deliver",
    "recipe-refresh",
    "agent-skills-list",
    "bootstrap-workspaces",
    "code-factory",
    "eval-runner",
    # AgentCore Code Sandbox narrow REST endpoints (plan Unit 10 + Unit 11).
    # Both are service-endpoint shape: the Strands container POSTs with
    # Bearer API_AUTH_SECRET. No GraphQL resolver involvement, no extra IAM.
    "sandbox-quota-check",
    "sandbox-invocation-log",
    # Skill-run dispatcher runtime-config fetch (plan
    # docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md §U1). The
    # Strands container's `kind=run_skill` handler calls this with Bearer
    # API_AUTH_SECRET to pull the agent's template + skills + MCP + KBs
    # before building the headless agent turn.
    "agents-runtime-config",
    # Admin-Ops MCP — JSON-RPC endpoint at POST /mcp/admin, exposes the
    # @thinkwork/admin-ops package as MCP tools for Strands agents.
    "admin-ops-mcp",
    # MCP admin key management — per-tenant Bearer tokens for admin-ops.
    # Admin-ops-mcp authenticates incoming tokens by sha256-hash lookup
    # against tenant_mcp_admin_keys, populated by this handler's routes.
    "mcp-admin-keys",
    # One-shot tenant provisioning: mints a tkm_ key + stores in Secrets
    # Manager at thinkwork/<stage>/mcp/<tenantId>/admin-ops + upserts
    # tenant_mcp_servers. SM IAM is already granted on thinkwork/* by
    # aws_iam_role_policy.lambda_secrets in main.tf (Create/Update/Get).
    "mcp-admin-provision",
    # Plugin-installed MCP server admin approval (plan §U11, SI-5). Cognito
    # JWT admin caller → approve/reject. Approve computes url_hash =
    # sha256(canonical(url, auth_config)) and pins it; any subsequent
    # mutation to those fields reverts the row to 'pending'.
    "mcp-approval",
    # Daily sweeper: auto-rejects MCP servers pending > 30 days. Triggered
    # by EventBridge schedule (mcp-approval-sweeper-daily).
    "mcp-approval-sweeper",
    # Plugin upload REST handler (plan §U10). Four routes:
    # POST /api/plugins/presign + /upload, GET /api/plugins (+ /:uploadId).
    # Cognito JWT; admin-role gated. Needs WORKSPACE_BUCKET env for S3.
    "plugin-upload",
    # Folder bundle import (fat-folder plan Phase D). Admin uploads a zip
    # or GitHub ref and the handler normalizes vendor folder layouts into
    # the agent workspace.
    "folder-bundle-import",
    # Hourly sweeper: reaps orphan S3 staging from failed / interrupted
    # plugin install sagas + marks matching plugin_uploads rows 'failed'.
    "plugin-staging-sweeper",
    # Resolved Capability Manifest write endpoint (plan §U15). Strands
    # container POSTs one row per agent-session-start. Shared
    # API_AUTH_SECRET bearer (runtime→API; no tenant OAuth).
    "manifest-log",
    # SI-7 catalog-list read endpoint (plan §U15 pt 3/3). Strands
    # container fetches the allowed builtin-tool slug set once per
    # session-start + feature-flag-gated enforcement filter drops
    # catalog-missing tools before Agent(tools=...). Shared
    # API_AUTH_SECRET bearer.
    "capability-catalog-list",
  ]) : toset([])

  function_name = "thinkwork-${var.stage}-api-${each.key}"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = local.runtime
  # eval-runner walks every test case sequentially, invoking an agent +
  # waiting up to 2 min for spans to propagate per test, so a 10-test run
  # can easily exceed the 30 s default. 900 s covers ~5-15 min sweeps.
  # wiki-bootstrap-import runs a full Hindsight ingest for ~3,000 records;
  # the LLM-backed retain path makes it the longest-running Lambda in the
  # set. 900 s is Lambda's per-invocation max and matches eval-runner's ceiling.
  timeout     = each.key == "wakeup-processor" ? 300 : each.key == "chat-agent-invoke" ? 300 : each.key == "workspace-event-dispatcher" ? 60 : each.key == "eval-runner" ? 900 : each.key == "wiki-compile" ? 480 : each.key == "wiki-lint" ? 300 : each.key == "wiki-export" ? 600 : each.key == "wiki-bootstrap-import" ? 900 : each.key == "folder-bundle-import" ? 300 : 30
  memory_size = each.key == "graphql-http" ? 512 : each.key == "wakeup-processor" ? 512 : each.key == "workspace-event-dispatcher" ? 512 : each.key == "eval-runner" ? 512 : each.key == "wiki-compile" ? 1024 : each.key == "wiki-export" ? 1024 : each.key == "wiki-bootstrap-import" ? 1024 : each.key == "folder-bundle-import" ? 1024 : 256

  filename         = "${var.lambda_zips_dir}/${each.key}.zip"
  source_code_hash = filebase64sha256("${var.lambda_zips_dir}/${each.key}.zip")

  environment {
    variables = merge(
      local.common_env,
      { FUNCTION_NAME = each.key },
      lookup(local.handler_extra_env, each.key, {}),
    )
  }

  tags = {
    Name    = "thinkwork-${var.stage}-api-${each.key}"
    Handler = each.key
  }
}

# ---------------------------------------------------------------------------
# API Gateway routes → Lambda integrations
# ---------------------------------------------------------------------------

locals {
  # Map of route_key → handler name for API Gateway
  api_routes = local.use_local_zips ? {
    # GraphQL — the main API entry point
    "POST /graphql" = "graphql-http"
    "GET /graphql"  = "graphql-http"

    # Health check (keep placeholder alive too)
    # "GET /health" is handled by placeholder

    # Agents
    "ANY /api/agents/{proxy+}" = "agents"
    "ANY /api/agents"          = "agents"

    # Agent actions (start/stop/heartbeat/budget)
    "ANY /api/agent-actions/{proxy+}" = "agent-actions"

    # Messages
    "ANY /api/messages/{proxy+}" = "messages"
    "ANY /api/messages"          = "messages"

    # Teams
    "ANY /api/teams/{proxy+}"        = "teams"
    "ANY /api/teams"                 = "teams"
    "ANY /api/team-members/{proxy+}" = "team-members"

    # Tenants
    "ANY /api/tenants/{proxy+}" = "tenants"
    "ANY /api/tenants"          = "tenants"

    # Users
    "ANY /api/users/{proxy+}" = "users"
    "ANY /api/users"          = "users"

    # Invites
    "ANY /api/invites/{proxy+}" = "invites"
    "ANY /api/invites"          = "invites"

    # Skills
    "ANY /api/skills/{proxy+}" = "skills"
    "ANY /api/skills"          = "skills"

    # User Memory MCP OAuth/resource-server unblocker. These endpoints are
    # enough for `codex mcp login thinkwork-user-memory-dev` to discover OAuth,
    # register as a public PKCE client, sign the user in through Cognito, and
    # receive a bearer token for the User Memory MCP resource.
    "GET /.well-known/oauth-protected-resource"          = "mcp-oauth"
    "GET /.well-known/oauth-protected-resource/{proxy+}" = "mcp-oauth"
    "GET /.well-known/oauth-authorization-server"        = "mcp-oauth"
    "GET /.well-known/openid-configuration"              = "mcp-oauth"
    "GET /mcp/oauth/jwks"                                = "mcp-oauth"
    "POST /mcp/oauth/register"                           = "mcp-oauth"
    "GET /mcp/oauth/authorize"                           = "mcp-oauth"
    "GET /mcp/oauth/callback"                            = "mcp-oauth"
    "POST /mcp/oauth/token"                              = "mcp-oauth"
    "POST /mcp/oauth/revoke"                             = "mcp-oauth"
    "ANY /mcp/user-memory"                               = "mcp-user-memory"

    # Activity
    "ANY /api/activity/{proxy+}" = "activity"
    "ANY /api/activity"          = "activity"

    # Connections + OAuth
    "ANY /api/connections/{proxy+}" = "connections"
    "ANY /api/connections"          = "connections"
    "GET /api/oauth/authorize"      = "oauth-authorize"
    "GET /api/oauth/callback"       = "oauth-callback"

    # Stripe billing (unauthenticated — checkout is pre-signup; webhook is
    # server-to-server with Stripe signature verification).
    "POST /api/stripe/checkout-session"    = "stripe-checkout"
    "OPTIONS /api/stripe/checkout-session" = "stripe-checkout"
    "POST /api/stripe/webhook"             = "stripe-webhook"
    "POST /api/stripe/portal-session"      = "stripe-portal"
    "OPTIONS /api/stripe/portal-session"   = "stripe-portal"
    "GET /api/stripe/subscription"         = "stripe-subscription"
    "OPTIONS /api/stripe/subscription"     = "stripe-subscription"
    "GET /api/auth/me"                     = "auth-me"
    "OPTIONS /api/auth/me"                 = "auth-me"

    # Routines
    "ANY /api/routines/{proxy+}" = "routines"
    "ANY /api/routines"          = "routines"

    # Budgets
    "ANY /api/budgets/{proxy+}" = "budgets"
    "ANY /api/budgets"          = "budgets"

    # Guardrails
    "ANY /api/guardrails/{proxy+}" = "guardrails"
    "ANY /api/guardrails"          = "guardrails"

    # Scheduled Jobs
    "ANY /api/scheduled-jobs/{proxy+}" = "scheduled-jobs"
    "ANY /api/scheduled-jobs"          = "scheduled-jobs"
    "ANY /api/thread-turns/{proxy+}"   = "scheduled-jobs"
    "ANY /api/thread-turns"            = "scheduled-jobs"

    # Activation Agent runtime writeback. Shared API_AUTH_SECRET; OPTIONS
    # short-circuits in the handler before auth.
    "POST /api/activation/notify"        = "activation"
    "OPTIONS /api/activation/notify"     = "activation"
    "POST /api/activation/checkpoint"    = "activation"
    "OPTIONS /api/activation/checkpoint" = "activation"
    "POST /api/activation/complete"      = "activation"
    "OPTIONS /api/activation/complete"   = "activation"

    # Job Schedule Manager (EventBridge CRUD)
    "ANY /api/job-schedules/{proxy+}" = "job-schedule-manager"
    "ANY /api/job-schedules"          = "job-schedule-manager"

    # Integration webhooks (Unit 8 — composable-skills). Each integration
    # has its own Lambda + a specific route under /webhooks/{integration}/
    # {tenantId}. Specific routes take precedence over the {proxy+}
    # catch-all below, which still owns the legacy PRD-19 webhook-token
    # surface.
    "POST /webhooks/crm-opportunity/{tenantId}" = "webhook-crm-opportunity"
    "POST /webhooks/task-event/{tenantId}"      = "webhook-task-event"

    # Webhooks (public trigger) — legacy PRD-19 tokenized webhooks.
    "POST /webhooks/{proxy+}" = "webhooks"

    # Webhooks admin
    "ANY /api/webhooks/{proxy+}" = "webhooks-admin"
    "ANY /api/webhooks"          = "webhooks-admin"

    # Workspace files
    "ANY /api/workspaces/{proxy+}" = "workspace-files"

    # Knowledge bases
    "ANY /api/knowledge-bases/{proxy+}" = "knowledge-base-files"

    # Email
    "POST /api/email/send" = "email-send"

    # Memory
    "ANY /api/memory/{proxy+}" = "memory"

    # Artifacts
    "POST /api/artifacts/{proxy+}" = "artifact-deliver"

    # Recipes
    "POST /api/recipe-refresh" = "recipe-refresh"

    # GitHub App
    "ANY /api/github-app/{proxy+}" = "github-app"
    "POST /api/github/webhook"     = "github-app"

    # AgentCore Code Sandbox (plan Unit 10 + Unit 11). Strands container
    # calls both with Bearer API_AUTH_SECRET before + after every
    # executeCode. 429 on quota denial, 201 on audit-row insert.
    "POST /api/sandbox/quota/check-and-increment" = "sandbox-quota-check"
    "POST /api/sandbox/invocations"               = "sandbox-invocation-log"

    # Skill-run dispatcher runtime-config fetch. Service-auth GET.
    "GET /api/agents/runtime-config" = "agents-runtime-config"

    # Admin-Ops MCP server — single JSON-RPC endpoint. Strands agents
    # (and anyone else) POST with Bearer <tenant-scoped token> issued by
    # the mcp-admin-keys handler below. The shared API_AUTH_SECRET is
    # retained as a break-glass superuser path for bootstrap/debug.
    "POST /mcp/admin" = "admin-ops-mcp"

    # MCP admin key management — per-tenant Bearer token CRUD. Tokens
    # are shown ONCE at creation (POST returns raw value); server stores
    # sha256 hash only. These specific routes take precedence over the
    # existing `ANY /api/tenants/{proxy+}` route (tenants handler) per
    # API Gateway v2's most-specific-match rule.
    "POST /api/tenants/{tenantId}/mcp-admin-keys"           = "mcp-admin-keys"
    "GET /api/tenants/{tenantId}/mcp-admin-keys"            = "mcp-admin-keys"
    "DELETE /api/tenants/{tenantId}/mcp-admin-keys/{keyId}" = "mcp-admin-keys"

    # One-shot tenant provisioning for the admin-ops MCP. Mints a fresh
    # tkm_ key + stores it in Secrets Manager at
    # thinkwork/<stage>/mcp/<tenantId>/admin-ops + upserts the
    # tenant_mcp_servers row so the runtime picks the server up for
    # any agent that gets it assigned via agent_mcp_servers.
    "POST /api/tenants/{tenantId}/mcp-admin-provision" = "mcp-admin-provision"

    # MCP server admin approval (plan §U11, SI-5). Plugin-uploaded MCP
    # servers land with status='pending'; these routes flip them to
    # approved/rejected. Cognito JWT only (mcp-approval handler rejects
    # apikey callers) — the admin SPA is the sole UI surface.
    "POST /api/tenants/{tenantId}/mcp-servers/{serverId}/approve"    = "mcp-approval"
    "OPTIONS /api/tenants/{tenantId}/mcp-servers/{serverId}/approve" = "mcp-approval"
    "POST /api/tenants/{tenantId}/mcp-servers/{serverId}/reject"     = "mcp-approval"
    "OPTIONS /api/tenants/{tenantId}/mcp-servers/{serverId}/reject"  = "mcp-approval"

    # Plugin upload admin surface (plan §U10). Admin SPA drives the full
    # flow: POST /presign → browser PUT to presigned S3 URL → POST /upload
    # (validator + three-phase install saga). GET routes back the admin's
    # plugin history view. handleCors() short-circuits OPTIONS before auth
    # — required for the browser to preflight successfully.
    "POST /api/plugins/presign"       = "plugin-upload"
    "OPTIONS /api/plugins/presign"    = "plugin-upload"
    "POST /api/plugins/upload"        = "plugin-upload"
    "OPTIONS /api/plugins/upload"     = "plugin-upload"
    "GET /api/plugins"                = "plugin-upload"
    "OPTIONS /api/plugins"            = "plugin-upload"
    "GET /api/plugins/{uploadId}"     = "plugin-upload"
    "OPTIONS /api/plugins/{uploadId}" = "plugin-upload"

    # Fat-folder bundle import. OPTIONS is handled inside the Lambda before auth.
    "POST /api/agents/{agentId}/import-bundle"    = "folder-bundle-import"
    "OPTIONS /api/agents/{agentId}/import-bundle" = "folder-bundle-import"

    # Resolved Capability Manifest write endpoint (plan §U15). Strands
    # container posts one row per agent-session-start. Shared
    # API_AUTH_SECRET; no tenant OAuth.
    "POST /api/runtime/manifests"    = "manifest-log"
    "OPTIONS /api/runtime/manifests" = "manifest-log"

    # SI-7 catalog-list read (plan §U15 pt 3/3). Strands container fetches
    # the allowed slug set once per session-start. Shared API_AUTH_SECRET.
    "GET /api/runtime/capability-catalog"     = "capability-catalog-list"
    "OPTIONS /api/runtime/capability-catalog" = "capability-catalog-list"
  } : {}
}

resource "aws_apigatewayv2_integration" "handler" {
  for_each = local.api_routes

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.handler[each.value].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "handler" {
  for_each = local.api_routes

  api_id    = aws_apigatewayv2_api.main.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.handler[each.key].id}"
}

resource "aws_lambda_permission" "handler_apigw" {
  for_each = local.use_local_zips ? toset(distinct(values(local.api_routes))) : toset([])

  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Wakeup Processor — EventBridge schedule (every 1 min)
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "wakeup_processor" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-wakeup-processor"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wakeup-processor"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# webhook_deliveries retention cron — daily delete of rows older than 90 days
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "webhook_deliveries_cleanup" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-webhook-deliveries-cleanup"
  group_name          = "default"
  schedule_expression = "cron(0 4 * * ? *)" # daily at 04:00 UTC
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["webhook-deliveries-cleanup"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# Plugin staging sweeper — hourly orphan-S3 cleanup for interrupted install
# sagas (plan §U10). WORKSPACE_BUCKET env on the Lambda role already grants
# the list+delete IAM; this schedule is the hourly trigger. The sweeper's
# own cutoff constant (60 min) is independent of this cron cadence.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "plugin_staging_sweeper" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-plugin-staging-sweeper"
  group_name          = "default"
  schedule_expression = "rate(1 hour)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["plugin-staging-sweeper"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# MCP approval TTL sweeper — daily auto-reject of pending rows > 30 days old
# (plan §U11). A plugin whose MCP sat uncurated for a month is stale: clear
# pending to keep the admin queue honest and surface the reject action in
# the audit log.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "mcp_approval_sweeper" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-mcp-approval-sweeper"
  group_name          = "default"
  schedule_expression = "cron(15 4 * * ? *)" # daily at 04:15 UTC (offset from webhook cleanup)
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["mcp-approval-sweeper"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# skill_runs reconciler — transitions stuck-running rows to failed every 5 min.
# Guards against agentcore Lambda crashes / OOMs that drop the
# /api/skills/complete writeback and leave the row at 'running' forever,
# which in turn blocks the dedup partial unique index from letting retries
# through.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "skill_runs_reconciler" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-skill-runs-reconciler"
  group_name          = "default"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["skill-runs-reconciler"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# Compounding Memory — nightly hygiene + export
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "wiki_compile_drainer" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-wiki-compile-drainer"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wiki-compile"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

resource "aws_scheduler_schedule" "wiki_lint" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-wiki-lint"
  group_name          = "default"
  schedule_expression = "cron(0 2 * * ? *)" # daily at 02:00 UTC
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wiki-lint"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

resource "aws_scheduler_schedule" "wiki_export" {
  count = local.use_local_zips ? 1 : 0

  name                = "thinkwork-${var.stage}-wiki-export"
  group_name          = "default"
  schedule_expression = "cron(0 3 * * ? *)" # daily at 03:00 UTC (after lint)
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wiki-export"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# S3 bucket for markdown vault exports. One bundle per (tenant, owner, date).
# Retention is handled by the lifecycle rule below (30 days).
resource "aws_s3_bucket" "wiki_exports" {
  bucket        = "thinkwork-${var.stage}-wiki-exports"
  force_destroy = var.stage == "dev"

  tags = {
    Name = "thinkwork-${var.stage}-wiki-exports"
  }
}

resource "aws_s3_bucket_public_access_block" "wiki_exports" {
  bucket                  = aws_s3_bucket.wiki_exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "wiki_exports" {
  bucket = aws_s3_bucket.wiki_exports.id

  rule {
    id     = "expire-old-bundles"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }
  }
}

resource "aws_iam_role_policy" "lambda_wiki_exports_s3" {
  name = "wiki-exports-s3"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]
      Resource = "${aws_s3_bucket.wiki_exports.arn}/*"
    }]
  })
}

resource "aws_iam_role" "scheduler" {
  name = "thinkwork-${var.stage}-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "invoke-lambda"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = local.use_local_zips ? [for k, v in aws_lambda_function.handler : v.arn] : []
    }]
  })
}

# ---------------------------------------------------------------------------
# SSM Parameters — Lambda ARNs for cross-function invocation
# ---------------------------------------------------------------------------

########################################################################
# SecureString parameter for the Google Places API key. wiki-compile reads
# this on cold start via loadGooglePlacesClientFromSsm() and caches the
# client at module scope. When google_places_api_key is empty (the
# default), we seed the parameter with a placeholder so the Lambda init
# path can distinguish "unconfigured" (skip Google entirely, degrade
# gracefully) from "configured but wrong" (log + skip). lifecycle.ignore_
# changes on `value` lets ops rotate via
#   aws ssm put-parameter --overwrite \
#     --name /thinkwork/<stage>/google-places/api-key \
#     --type SecureString --value <KEY>
# without terraform fighting it on the next apply.
########################################################################

resource "aws_ssm_parameter" "google_places_api_key" {
  name        = "/thinkwork/${var.stage}/google-places/api-key"
  type        = "SecureString"
  value       = var.google_places_api_key != "" ? var.google_places_api_key : "PLACEHOLDER_SET_VIA_CLI"
  description = "Google Places API (New) key consumed by wiki-compile. See docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md Unit 4."

  lifecycle {
    # Allow `aws ssm put-parameter --overwrite` to stick across applies.
    # New-key rotation or initial population by ops should happen via CLI,
    # not via terraform var.
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "lambda_arns" {
  for_each = local.use_local_zips ? {
    "chat-agent-invoke-fn-arn"    = aws_lambda_function.handler["chat-agent-invoke"].arn
    "kb-manager-fn-arn"           = aws_lambda_function.handler["knowledge-base-manager"].arn
    "job-schedule-manager-fn-arn" = aws_lambda_function.handler["job-schedule-manager"].arn
    "memory-retain-fn-arn"        = aws_lambda_function.handler["memory-retain"].arn
    "eval-runner-fn-arn"          = aws_lambda_function.handler["eval-runner"].arn
  } : {}

  name  = "/thinkwork/${var.stage}/${each.key}"
  type  = "String"
  value = each.value
}
