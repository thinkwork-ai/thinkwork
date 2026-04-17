################################################################################
# Lambda API — App Module
#
# Creates the API Gateway V2 HTTP API and a shared Lambda execution role.
# Individual Lambda functions are added in migration Phases 2-4 as their
# code is ported. For Phase 1, a hello-world placeholder Lambda proves
# the infrastructure works end-to-end.
#
# In production this module will contain 30+ Lambda functions covering:
# - GraphQL HTTP handler (the main API entry point)
# - Agent invoke / chat
# - Thread, agent, template, connector CRUD
# - Skills, KB, memory handlers
# - Connectors (Slack, GitHub, Google)
# - Email inbound/outbound
# - OAuth callbacks
################################################################################

data "aws_caller_identity" "current" {}

################################################################################
# API Gateway V2 — HTTP API
################################################################################

resource "aws_apigatewayv2_api" "main" {
  name          = "thinkwork-${var.stage}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["Content-Type", "Authorization", "x-api-key", "x-tenant-id", "x-tenant-slug", "x-principal-id"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_origins = var.cors_allowed_origins
    max_age       = 3600
  }

  tags = {
    Name = "thinkwork-${var.stage}-api"
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  tags = {
    Name = "thinkwork-${var.stage}-api-default"
  }
}

################################################################################
# Custom Domain (optional)
################################################################################

resource "aws_apigatewayv2_domain_name" "main" {
  count       = var.custom_domain != "" ? 1 : 0
  domain_name = var.custom_domain

  domain_name_configuration {
    certificate_arn = var.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "main" {
  count       = var.custom_domain != "" ? 1 : 0
  api_id      = aws_apigatewayv2_api.main.id
  domain_name = aws_apigatewayv2_domain_name.main[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

################################################################################
# Shared Lambda Execution Role
################################################################################

resource "aws_iam_role" "lambda" {
  name = "thinkwork-${var.stage}-api-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_rds" {
  name = "rds-data-api"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "rds-data:ExecuteStatement",
        "rds-data:BatchExecuteStatement",
        "rds-data:BeginTransaction",
        "rds-data:CommitTransaction",
        "rds-data:RollbackTransaction",
      ]
      Resource = var.db_cluster_arn
    }]
  })
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name = "secrets-manager"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.graphql_db_secret_arn
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_s3" {
  name = "s3-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
      ]
      Resource = [
        var.bucket_arn,
        "${var.bucket_arn}/*",
      ]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_cognito" {
  name = "cognito-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:ListUsers",
      ]
      Resource = var.user_pool_arn
    }]
  })
}

resource "aws_iam_role_policy" "lambda_cloudwatch_read" {
  name = "cloudwatch-logs-read"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:FilterLogEvents", "logs:GetLogEvents", "logs:DescribeLogGroups"]
      Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:*model-invocations*"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_bedrock" {
  name = "bedrock-invoke"
  role = aws_iam_role.lambda.id

  # Cross-region inference profiles (us.anthropic.claude-*) require
  # `bedrock:InvokeModel` on the *inference-profile* ARN in addition to
  # the underlying foundation model. Needed by the eval-runner's
  # llm-rubric judge and any other handler that calls Converse with a
  # profile ID.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = [
        "arn:aws:bedrock:${var.region}::foundation-model/*",
        "arn:aws:bedrock:${var.region}:${var.account_id}:inference-profile/*",
      ]
    }]
  })
}

# SES send permissions for the email-send handler. Scoped to any
# verified identity in this account+region so the email-send Lambda
# can SendRawEmail from agents.thinkwork.ai (and any other domain
# identity a future deployment might add).
resource "aws_iam_role_policy" "lambda_ses_send" {
  name = "ses-send"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail",
      ]
      Resource = [
        "arn:aws:ses:${var.region}:${var.account_id}:identity/*",
        "arn:aws:ses:${var.region}:${var.account_id}:configuration-set/*",
      ]
    }]
  })
}

# Allow API Lambdas to directly invoke the AgentCore Lambda. Used by
# chat-agent-invoke (and future wake-up/retry paths) via InvokeCommand.
resource "aws_iam_role_policy" "lambda_agentcore_invoke" {
  count = var.agentcore_function_arn != "" ? 1 : 0
  name  = "agentcore-invoke"
  role  = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "lambda:InvokeFunction",
      ]
      Resource = [
        var.agentcore_function_arn,
        "${var.agentcore_function_arn}:*",
      ]
    }]
  })
}

# Eval-runner: invoke the AgentCore Runtime data plane to run an agent
# under test, and call AgentCore Evaluations.Evaluate to score the
# resulting spans. Both APIs are on the bedrock-agentcore service. Also
# allow reading spans + log events from CloudWatch Logs (aws/spans is
# the Transaction Search destination; the runtime log groups carry the
# OTel scope=strands.telemetry.tracer log records that EvaluateCommand
# requires alongside the spans).
resource "aws_iam_role_policy" "lambda_eval_runner" {
  name = "eval-runner-bedrock-agentcore"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AgentCoreInvokeRuntime"
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:runtime/*"
      },
      {
        Sid    = "AgentCoreEvaluate"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:Evaluate",
          "bedrock-agentcore:GetEvaluator",
          "bedrock-agentcore:ListEvaluators",
        ]
        Resource = "*"
      },
      {
        Sid    = "EvalSpansRead"
        Effect = "Allow"
        Action = [
          "logs:FilterLogEvents",
          "logs:GetLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:aws/spans",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:aws/spans:*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:*",
        ]
      },
      {
        Sid      = "SsmReadEvalRunnerCfg"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/agentcore/runtime-id-*"
      },
    ]
  })
}

# AgentCore Memory read access for the GraphQL memory resolvers.
# memoryRecords / memorySearch call ListMemoryRecordsCommand to fetch
# records across the tenant's agents.
resource "aws_iam_role_policy" "lambda_agentcore_memory" {
  name = "agentcore-memory-rw"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock-agentcore:ListMemoryRecords",
        "bedrock-agentcore:RetrieveMemoryRecords",
        "bedrock-agentcore:GetMemoryRecord",
        "bedrock-agentcore:BatchCreateMemoryRecords",
        "bedrock-agentcore:BatchUpdateMemoryRecords",
        "bedrock-agentcore:BatchDeleteMemoryRecords",
        "bedrock-agentcore:DeleteMemoryRecord",
      ]
      Resource = "*"
    }]
  })
}

# graphql-http's sendMessage mutation reads SSM parameters like
# /thinkwork/${stage}/chat-agent-invoke-fn-arn to discover the direct
# Lambda targets for cross-function invocation. Without this, the SSM
# GetParameter call fails with AccessDenied, the caller silently
# catches the error, and sendMessage falls back to the wakeup-processor
# path — which doesn't load messages_history from Aurora. That's why
# multi-turn chat was losing prior context: history was only loaded on
# the direct path, which never ran.
resource "aws_iam_role_policy" "lambda_ssm_read" {
  name = "ssm-param-read"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters",
      ]
      Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/*"
    }]
  })
}

# job-schedule-manager creates/updates/deletes EventBridge Scheduler
# schedules (and the thinkwork-jobs schedule group on first use). Without
# these permissions the manager Lambda threw silently and every scheduled
# automation was orphaned with eb_schedule_name = null.
resource "aws_iam_role_policy" "lambda_scheduler" {
  name = "eventbridge-scheduler-rw"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
          "scheduler:CreateScheduleGroup",
          "scheduler:GetScheduleGroup",
          "scheduler:DeleteScheduleGroup",
          "scheduler:TagResource",
        ]
        Resource = "*"
      },
      # Scheduler.CreateSchedule takes a RoleArn for the target; AWS requires
      # the caller to have iam:PassRole on that role. Without this the
      # CreateSchedule call fails with AccessDenied even if the scheduler
      # permissions above are set.
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = var.job_scheduler_role_arn != "" ? var.job_scheduler_role_arn : "*"
      },
    ]
  })
}

# Allow API handler Lambdas to invoke each other directly. sendMessage
# dispatches to chat-agent-invoke for instant chat response; the memory
# resolvers reach knowledge-base-manager and job-schedule-manager for
# admin-driven operations. The existing lambda_agentcore_invoke policy
# covers the Strands runtime Lambda only — this one covers internal
# api-to-api calls. ARNs are constructed deterministically from the
# handler naming pattern so we don't create a dependency cycle with the
# handler resource.
resource "aws_iam_role_policy" "lambda_api_cross_invoke" {
  name = "api-cross-function-invoke"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      Resource = [
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-chat-agent-invoke",
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-knowledge-base-manager",
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-schedule-manager",
        # eval-runner: graphql-http's startEvalRun mutation Event-invokes
        # this asynchronously after inserting the eval_runs row.
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-eval-runner",
      ]
    }]
  })
}

################################################################################
# Placeholder Lambda — proves the infrastructure works
#
# This will be replaced by real handlers in Phases 2-4.
################################################################################

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.build/placeholder.zip"

  source {
    content  = <<-JS
      exports.handler = async (event) => ({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ok", stage: process.env.STAGE }),
      });
    JS
    filename = "index.js"
  }
}

resource "aws_lambda_function" "placeholder" {
  function_name = "thinkwork-${var.stage}-api-placeholder"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      STAGE = var.stage
    }
  }

  tags = {
    Name = "thinkwork-${var.stage}-api-placeholder"
  }
}

resource "aws_apigatewayv2_integration" "placeholder" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.placeholder.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "placeholder" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.placeholder.id}"
}

resource "aws_lambda_permission" "placeholder_apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.placeholder.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
