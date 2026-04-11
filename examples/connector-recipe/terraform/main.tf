terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.region
}

locals {
  name_prefix  = "thinkwork-connector-${var.connector_id}-${var.stage}"
  handler_dir  = "${path.module}/../handler"
}

# ── Lambda deployment package ────────────────────────────────────────────────

data "archive_file" "handler" {
  type        = "zip"
  source_dir  = local.handler_dir
  output_path = "${path.module}/.build/handler.zip"
}

# ── IAM role for Lambda ───────────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${local.name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Allow Lambda to write logs to CloudWatch
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda function ───────────────────────────────────────────────────────────

resource "aws_lambda_function" "connector" {
  function_name    = local.name_prefix
  description      = "Thinkwork connector webhook handler for ${var.connector_id}"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "main.handler"
  filename         = data.archive_file.handler.output_path
  source_code_hash = data.archive_file.handler.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      THINKWORK_API_URL      = var.thinkwork_api_url
      THINKWORK_API_KEY      = var.thinkwork_api_key
      WEBHOOK_SIGNING_SECRET = var.webhook_signing_secret
      CONNECTOR_ID           = var.connector_id
      DEFAULT_AGENT_ID       = var.default_agent_id
    }
  }
}

# ── API Gateway v2 (HTTP API) ─────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "webhook" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"
  description   = "Webhook endpoint for Thinkwork connector: ${var.connector_id}"
}

# Allow API Gateway to invoke the Lambda
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.connector.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/*"
}

# Lambda integration — forward all requests to the handler
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.webhook.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.connector.invoke_arn
  payload_format_version = "2.0"
}

# Single catch-all route: POST /webhook
resource "aws_apigatewayv2_route" "webhook" {
  api_id    = aws_apigatewayv2_api.webhook.id
  route_key = "POST /webhook"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Auto-deployed stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.webhook.id
  name        = "$default"
  auto_deploy = true
}
