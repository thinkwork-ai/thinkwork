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
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
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

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "arn:aws:bedrock:${var.region}::foundation-model/*"
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
