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
    STAGE                   = var.stage
    DATABASE_URL            = "postgresql://${var.db_username}:${urlencode(var.db_password)}@${var.db_cluster_endpoint}:5432/${var.database_name}?sslmode=no-verify"
    DATABASE_SECRET_ARN     = var.graphql_db_secret_arn
    DATABASE_HOST           = var.db_cluster_endpoint
    DATABASE_NAME           = var.database_name
    BUCKET_NAME             = var.bucket_name
    USER_POOL_ID            = var.user_pool_id
    COGNITO_USER_POOL_ID    = var.user_pool_id
    ADMIN_CLIENT_ID         = var.admin_client_id
    MOBILE_CLIENT_ID        = var.mobile_client_id
    COGNITO_APP_CLIENT_IDS  = "${var.admin_client_id},${var.mobile_client_id}"
    APPSYNC_ENDPOINT        = var.appsync_api_url
    APPSYNC_API_KEY         = var.appsync_api_key
    GRAPHQL_API_KEY         = var.appsync_api_key
    API_AUTH_SECRET         = var.api_auth_secret
    THINKWORK_API_SECRET    = var.api_auth_secret
    EMAIL_HMAC_SECRET       = var.api_auth_secret
    THINKWORK_API_URL       = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com"
    AGENTCORE_FUNCTION_NAME = var.agentcore_function_name
    WORKSPACE_BUCKET        = var.bucket_name
    HINDSIGHT_ENDPOINT      = var.hindsight_endpoint
    AGENTCORE_MEMORY_ID     = var.agentcore_memory_id
    MEMORY_ENGINE           = var.memory_engine
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
  }

  # Per-handler env-var overrides. ARNs are constructed from the naming
  # pattern (same trick as lambda_api_cross_invoke in main.tf) so we don't
  # introduce a self-referential dependency inside the handler for_each.
  handler_extra_env = {
    "job-schedule-manager" = {
      JOB_TRIGGER_ARN      = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger"
      JOB_TRIGGER_ROLE_ARN = var.job_scheduler_role_arn
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
    "agents",
    "agent-actions",
    "messages",
    "connections",
    "oauth-authorize",
    "oauth-callback",
    "teams",
    "team-members",
    "tenants",
    "users",
    "invites",
    "skills",
    "activity",
    "routines",
    "budgets",
    "guardrails",
    "scheduled-jobs",
    "job-schedule-manager",
    "job-trigger",
    "webhooks",
    "webhooks-admin",
    "integration-webhooks",
    "workspace-files",
    "knowledge-base-manager",
    "knowledge-base-files",
    "email-send",
    "email-inbound",
    "github-app",
    "github-repos",
    "memory",
    "memory-retain",
    "artifact-deliver",
    "recipe-refresh",
    "connector-installs",
    "connector-secrets",
    "agent-skills-list",
    "bootstrap-workspaces",
    "code-factory",
  ]) : toset([])

  function_name = "thinkwork-${var.stage}-api-${each.key}"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = local.runtime
  timeout       = each.key == "wakeup-processor" ? 300 : each.key == "chat-agent-invoke" ? 300 : 30
  memory_size   = each.key == "graphql-http" ? 512 : each.key == "wakeup-processor" ? 512 : 256

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

    # Activity
    "ANY /api/activity/{proxy+}" = "activity"
    "ANY /api/activity"          = "activity"

    # Connections + OAuth
    "ANY /api/connections/{proxy+}" = "connections"
    "ANY /api/connections"          = "connections"
    "GET /api/oauth/authorize"      = "oauth-authorize"
    "GET /api/oauth/callback"       = "oauth-callback"

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

    # Job Schedule Manager (EventBridge CRUD)
    "ANY /api/job-schedules/{proxy+}" = "job-schedule-manager"
    "ANY /api/job-schedules"          = "job-schedule-manager"

    # Webhooks (public trigger)
    "POST /webhooks/{proxy+}" = "webhooks"

    # Webhooks admin
    "ANY /api/webhooks/{proxy+}" = "webhooks-admin"
    "ANY /api/webhooks"          = "webhooks-admin"

    # Integration webhooks (signature-authed, per-provider)
    "POST /integrations/{provider}/webhook" = "integration-webhooks"

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

    # Connectors
    "ANY /api/connector-installs/{proxy+}" = "connector-installs"
    "ANY /api/connector-secrets/{proxy+}"  = "connector-secrets"
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

resource "aws_ssm_parameter" "lambda_arns" {
  for_each = local.use_local_zips ? {
    "chat-agent-invoke-fn-arn"    = aws_lambda_function.handler["chat-agent-invoke"].arn
    "kb-manager-fn-arn"           = aws_lambda_function.handler["knowledge-base-manager"].arn
    "job-schedule-manager-fn-arn" = aws_lambda_function.handler["job-schedule-manager"].arn
    "memory-retain-fn-arn"        = aws_lambda_function.handler["memory-retain"].arn
  } : {}

  name  = "/thinkwork/${var.stage}/${each.key}"
  type  = "String"
  value = each.value
}
