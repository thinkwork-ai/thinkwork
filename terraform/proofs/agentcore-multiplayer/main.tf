terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    external = {
      source  = "hashicorp/external"
      version = ">= 2.3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

locals {
  prefix           = "thinkwork-${var.stage}-think316"
  assertion_issuer = "${aws_apigatewayv2_api.proof.api_endpoint}/agentcore"
  oauth_issuer     = "${aws_apigatewayv2_api.proof.api_endpoint}/agentcore-proof/oauth"
  harness_audience = "urn:thinkwork:${var.stage}:agentcore:harness"
  gateway_audience = "urn:thinkwork:${var.stage}:agentcore:gateway"
  assertion_kid    = "thinkwork-${var.stage}-think316-v1"
}

resource "random_password" "oauth_client_secret" {
  length  = 48
  special = false
}

resource "aws_iam_role" "issuer" {
  name = "${local.prefix}-issuer-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role" "boundary" {
  name = "${local.prefix}-boundary-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role" "oauth_provider" {
  name = "${local.prefix}-oauth-provider-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "issuer_logs" {
  role       = aws_iam_role.issuer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "boundary_logs" {
  role       = aws_iam_role.boundary.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "oauth_provider_logs" {
  role       = aws_iam_role.oauth_provider.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "oauth_provider_sign" {
  name = "gateway-token-sign"
  role = aws_iam_role.oauth_provider.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign"]
      Resource = aws_kms_key.assertion.arn
      Condition = {
        StringEquals = { "kms:SigningAlgorithm" = "RSASSA_PKCS1_V1_5_SHA_256" }
      }
    }]
  })
}

resource "aws_kms_key" "assertion" {
  description              = "Ephemeral THINK-316 assertion signer"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_2048"
  deletion_window_in_days  = 7

  tags = {
    purpose    = "think-316-proof"
    managed-by = "terraform"
  }
}

resource "aws_kms_alias" "assertion" {
  name          = "alias/${local.prefix}-assertion"
  target_key_id = aws_kms_key.assertion.key_id
}

resource "aws_iam_role_policy" "issuer_public_key" {
  name = "assertion-public-key"
  role = aws_iam_role.issuer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:GetPublicKey"]
      Resource = aws_kms_key.assertion.arn
    }]
  })
}

resource "aws_lambda_function" "issuer" {
  function_name    = "${local.prefix}-issuer"
  role             = aws_iam_role.issuer.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = "${var.lambda_zips_dir}/mcp-oauth.zip"
  source_code_hash = filebase64sha256("${var.lambda_zips_dir}/mcp-oauth.zip")
  timeout          = 15

  environment {
    variables = {
      AGENTCORE_TURN_ASSERTION_ISSUER     = local.assertion_issuer
      AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = aws_kms_key.assertion.arn
      AGENTCORE_TURN_ASSERTION_KID        = local.assertion_kid
    }
  }
}

resource "aws_lambda_function" "oauth_provider" {
  function_name    = "${local.prefix}-oauth-provider"
  role             = aws_iam_role.oauth_provider.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = "${var.lambda_zips_dir}/agentcore-proof-oauth-provider.zip"
  source_code_hash = filebase64sha256("${var.lambda_zips_dir}/agentcore-proof-oauth-provider.zip")
  timeout          = 15

  environment {
    variables = {
      AGENTCORE_PROOF_OAUTH_ISSUER        = local.oauth_issuer
      AGENTCORE_PROOF_OAUTH_CLIENT_ID     = "${local.prefix}-client"
      AGENTCORE_PROOF_OAUTH_CLIENT_SECRET = random_password.oauth_client_secret.result
      AGENTCORE_ASSERTION_ISSUER          = local.assertion_issuer
      AGENTCORE_HARNESS_AUDIENCE          = local.harness_audience
      AGENTCORE_GATEWAY_AUDIENCE          = local.gateway_audience
      AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = aws_kms_key.assertion.arn
      AGENTCORE_TURN_ASSERTION_KID        = local.assertion_kid
    }
  }
}

resource "aws_lambda_function" "target" {
  function_name    = "${local.prefix}-target"
  role             = aws_iam_role.boundary.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = "${var.lambda_zips_dir}/agentcore-identity-boundary-target.zip"
  source_code_hash = filebase64sha256("${var.lambda_zips_dir}/agentcore-identity-boundary-target.zip")
  timeout          = 15

  environment {
    variables = {
      AGENTCORE_PROOF_OAUTH_ISSUER        = local.oauth_issuer
      AGENTCORE_PROOF_OAUTH_CLIENT_SECRET = random_password.oauth_client_secret.result
    }
  }
}

resource "aws_apigatewayv2_api" "proof" {
  name          = "${local.prefix}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.proof.id
  name        = "$default"
  auto_deploy = true
}

locals {
  functions = {
    issuer         = aws_lambda_function.issuer
    oauth_provider = aws_lambda_function.oauth_provider
    target         = aws_lambda_function.target
  }
  routes = {
    "GET /agentcore/.well-known/openid-configuration"             = "issuer"
    "GET /agentcore/oauth/jwks"                                   = "issuer"
    "GET /agentcore-proof/oauth/.well-known/openid-configuration" = "oauth_provider"
    "GET /agentcore-proof/oauth/authorize"                        = "oauth_provider"
    "POST /agentcore-proof/oauth/token"                           = "oauth_provider"
    "GET /agentcore-proof/target/owner"                           = "target"
    "GET /agentcore-proof/target/mixed"                           = "target"
  }
}

resource "aws_apigatewayv2_integration" "proof" {
  for_each = local.functions

  api_id                 = aws_apigatewayv2_api.proof.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "proof" {
  for_each = local.routes

  api_id    = aws_apigatewayv2_api.proof.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.proof[each.value].id}"
}

resource "aws_lambda_permission" "apigw" {
  for_each = local.functions

  statement_id  = "AllowThink316ProofApi"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.proof.execution_arn}/*/*"
}

module "identity" {
  source = "../../modules/app/agentcore-identity"

  enabled             = true
  stage               = "${var.stage}-think316"
  region              = var.region
  account_id          = data.aws_caller_identity.current.account_id
  oauth_issuer        = local.oauth_issuer
  oauth_client_id     = "${local.prefix}-client"
  oauth_client_secret = random_password.oauth_client_secret.result
  user_federation_return_urls = [
    "${aws_apigatewayv2_api.proof.api_endpoint}/api/skills/mcp-oauth/agentcore/complete",
  ]

  depends_on = [aws_apigatewayv2_route.proof]
}

module "gateway" {
  source = "../../modules/app/agentcore-gateway"

  enabled                       = true
  stage                         = "${var.stage}-think316"
  region                        = var.region
  account_id                    = data.aws_caller_identity.current.account_id
  discovery_url                 = "${local.assertion_issuer}/.well-known/openid-configuration"
  gateway_audience              = local.gateway_audience
  target_base_url               = aws_apigatewayv2_api.proof.api_endpoint
  oauth_credential_provider_arn = module.identity.credential_provider_arn
  oauth_credential_secret_arn   = module.identity.credential_secret_arn
  oauth_return_url              = module.identity.oauth_return_url

  depends_on = [aws_apigatewayv2_route.proof]
}
