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
# - Thread, agent, and template CRUD
# - Skills, KB, memory handlers
# - Webhook, MCP, and OAuth handlers
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
# MCP Custom Domain (optional) — second domain on the same HTTP API.
#
# Two-apply dance because ACM requires DNS validation before a Regional
# custom domain can bind the cert. `var.mcp_custom_domain_ready = false`
# (first apply) creates just the cert in pending-validation state and
# surfaces the validation record via `mcp_custom_domain_validation` output.
# The operator adds that record to Cloudflare (via `pnpm cf:sync-mcp`),
# waits ~5 min for ACM validation, then sets `mcp_custom_domain_ready =
# true` for the second apply, which creates the domain + API mapping.
# A final `pnpm cf:sync-mcp --finalize` adds the `mcp.thinkwork.ai`
# CNAME pointing at the regional domain target.
#
# See docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md.
################################################################################

resource "aws_acm_certificate" "mcp" {
  count             = var.mcp_custom_domain != "" ? 1 : 0
  domain_name       = var.mcp_custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-mcp-cert"
  }
}

resource "aws_apigatewayv2_domain_name" "mcp" {
  count       = var.mcp_custom_domain != "" && var.mcp_custom_domain_ready ? 1 : 0
  domain_name = var.mcp_custom_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.mcp[0].arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = {
    Name = "thinkwork-${var.stage}-mcp-domain"
  }
}

resource "aws_apigatewayv2_api_mapping" "mcp" {
  count       = var.mcp_custom_domain != "" && var.mcp_custom_domain_ready ? 1 : 0
  api_id      = aws_apigatewayv2_api.main.id
  domain_name = aws_apigatewayv2_domain_name.mcp[0].id
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

# All other IAM grants for aws_iam_role.lambda live in the four grouped
# customer-managed policies in iam-grouped.tf (R9, plan 2026-06-11-006 U6).
# Do not add inline aws_iam_role_policy resources to this role: the inline
# aggregate hit IAM's 10,240-byte cap on 2026-06-11 (#2378/#2379). New grants
# go into the grouped managed policies, never inline.

resource "aws_iam_role_policy_attachment" "lambda_cognee_worker_vpc_access" {
  count = (
    (var.cognee_enabled && length(var.cognee_worker_subnet_ids) > 0 && length(var.cognee_worker_security_group_ids) > 0) ||
    (length(var.okf_efs_subnet_ids) > 0 && length(var.okf_efs_security_group_ids) > 0 && var.okf_efs_refresh_access_point_arn != "")
  ) ? 1 : 0

  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
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
