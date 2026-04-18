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
    # LastMile Tasks REST API base URL — feature-flags the outbound sync
    # path. When unset, syncExternalTaskOnCreate writes sync_status='local'
    # and the workflow picker proxy returns 503. Set to the LMI develop /
    # staging / prod base URL per stage to enable real cross-system sync.
    LASTMILE_TASKS_API_URL = var.lastmile_tasks_api_url
  }

  # Per-handler env-var overrides. ARNs are constructed from the naming
  # pattern (same trick as lambda_api_cross_invoke in main.tf) so we don't
  # introduce a self-referential dependency inside the handler for_each.
  handler_extra_env = {
    "job-schedule-manager" = {
      JOB_TRIGGER_ARN      = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger"
      JOB_TRIGGER_ROLE_ARN = var.job_scheduler_role_arn
    }
    # Compounding Memory compile Lambda. Claude Haiku 4.5 via Bedrock; the
    # planner + section-writer cap themselves at ~500 records / 25 new pages
    # per invocation, so a 480 s timeout covers the worst case comfortably.
    "wiki-compile" = {
      BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
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
    "webhook-deliveries-cleanup",
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
    "artifact-deliver",
    "recipe-refresh",
    "agent-skills-list",
    "bootstrap-workspaces",
    "code-factory",
    "eval-runner",
  ]) : toset([])

  function_name = "thinkwork-${var.stage}-api-${each.key}"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = local.runtime
  # eval-runner walks every test case sequentially, invoking an agent +
  # waiting up to 2 min for spans to propagate per test, so a 10-test run
  # can easily exceed the 30 s default. 900 s covers ~5-15 min sweeps.
  timeout     = each.key == "wakeup-processor" ? 300 : each.key == "chat-agent-invoke" ? 300 : each.key == "eval-runner" ? 900 : each.key == "wiki-compile" ? 480 : each.key == "wiki-lint" ? 300 : each.key == "wiki-export" ? 600 : 30
  memory_size = each.key == "graphql-http" ? 512 : each.key == "wakeup-processor" ? 512 : each.key == "eval-runner" ? 512 : each.key == "wiki-compile" ? 1024 : each.key == "wiki-export" ? 1024 : 256

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
# Compounding Memory — nightly hygiene + export
# ---------------------------------------------------------------------------

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
      Effect = "Allow"
      Action = ["s3:PutObject", "s3:AbortMultipartUpload"]
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
