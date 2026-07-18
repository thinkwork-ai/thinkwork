locals {
  mcp_oauth_api_base_url          = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com"
  mcp_oauth_cognito_base_url      = var.cognito_auth_domain != "" ? "https://${var.cognito_auth_domain}.auth.${var.region}.amazoncognito.com" : ""
  mcp_oauth_identity_providers    = var.google_oauth_client_id != "" ? ["Google", "COGNITO"] : ["COGNITO"]
  mcp_oauth_logo_path             = "${path.module}/../../../../apps/web/public/logo.png"
  agentcore_turn_assertion_issuer = "${local.mcp_oauth_api_base_url}/agentcore"
  agentcore_harness_audience      = "urn:thinkwork:${var.stage}:agentcore:harness"
  agentcore_gateway_audience      = "urn:thinkwork:${var.stage}:agentcore:gateway"
  agentcore_turn_assertion_keys = {
    for version, key in aws_kms_key.agentcore_turn_assertion : version => {
      key_id = key.arn
      kid    = "thinkwork-${var.stage}-agentcore-turn-${version}"
    }
  }
  agentcore_turn_assertion_active_key = try(
    local.agentcore_turn_assertion_keys[var.agentcore_turn_assertion_active_key_version],
    { key_id = "", kid = "" },
  )
}

# THINK-316 U1: short-lived CUSTOM_JWT assertions are signed by KMS so private
# key material never enters Lambda configuration or process memory. The key
# policy is the capability boundary: the dedicated mint role can Sign, while
# the shared mcp-oauth role can only fetch the public key for JWKS publication.
resource "aws_iam_role" "turn_assertion_mint" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0
  name  = "thinkwork-${var.stage}-turn-assertion-mint-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "turn_assertion_mint_basic" {
  count      = var.enable_agentcore_multiplayer_proof ? 1 : 0
  role       = aws_iam_role.turn_assertion_mint[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The synthetic OAuth provider and boundary target are public proof surfaces
# but need no AWS data-plane permissions. A sibling logs-only role prevents a
# parser defect from inheriting the shared API role or its platform secrets.
resource "aws_iam_role" "agentcore_proof_boundary" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0
  name  = "thinkwork-${var.stage}-agentcore-proof-boundary-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "agentcore_proof_boundary_basic" {
  count      = var.enable_agentcore_multiplayer_proof ? 1 : 0
  role       = aws_iam_role.agentcore_proof_boundary[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The token-exchange provider is the only proof boundary allowed to mint the
# derived Gateway assertion. Keep that capability off the public target role.
resource "aws_iam_role" "agentcore_proof_provider" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0
  name  = "thinkwork-${var.stage}-agentcore-proof-provider-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "agentcore_proof_provider_basic" {
  count      = var.enable_agentcore_multiplayer_proof ? 1 : 0
  role       = aws_iam_role.agentcore_proof_provider[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "agentcore_proof_provider_kms" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0
  name  = "thinkwork-${var.stage}-agentcore-proof-provider-key"
  role  = aws_iam_role.agentcore_proof_provider[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign"]
      Resource = [local.agentcore_turn_assertion_active_key.key_id]
      Condition = {
        StringEquals = {
          "kms:SigningAlgorithm" = "RSASSA_PKCS1_V1_5_SHA_256"
        }
      }
    }]
  })
}

resource "aws_kms_key" "agentcore_turn_assertion" {
  for_each = var.enable_agentcore_multiplayer_proof ? toset(var.agentcore_turn_assertion_key_versions) : toset([])

  description              = "ThinkWork ${var.stage} AgentCore per-turn assertion signing ${each.key}"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_2048"
  deletion_window_in_days  = 7

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
    ]
  })

  tags = {
    Name       = "thinkwork-${var.stage}-agentcore-turn-assertion-${each.key}"
    KeyVersion = each.key
  }
}

resource "aws_kms_alias" "agentcore_turn_assertion" {
  for_each      = aws_kms_key.agentcore_turn_assertion
  name          = "alias/thinkwork-${var.stage}-agentcore-turn-assertion-${each.key}"
  target_key_id = each.value.key_id
}

# The mint role can sign with exactly the active key. The public discovery
# handler can read all currently published public keys, but can never sign.
resource "aws_iam_role_policy" "turn_assertion_mint_kms" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0
  name  = "thinkwork-${var.stage}-turn-assertion-active-key"
  role  = aws_iam_role.turn_assertion_mint[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign"]
      Resource = [local.agentcore_turn_assertion_active_key.key_id]
      Condition = {
        StringEquals = {
          "kms:SigningAlgorithm" = "RSASSA_PKCS1_V1_5_SHA_256"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "turn_assertion_jwks_kms" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0
  name  = "thinkwork-${var.stage}-turn-assertion-published-keys"
  role  = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:GetPublicKey"]
      Resource = [for key in values(local.agentcore_turn_assertion_keys) : key.key_id]
    }]
  })
}

resource "aws_dynamodb_table" "mcp_oauth_revocations" {
  name         = "thinkwork-${var.stage}-mcp-oauth-revocations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token_id_hash"

  attribute {
    name = "token_id_hash"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-mcp-oauth-revocations"
  }
}

resource "aws_cognito_user_pool_client" "mcp_oauth" {
  name         = "ThinkworkMcpOAuth"
  user_pool_id = var.user_pool_id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  supported_identity_providers = local.mcp_oauth_identity_providers

  callback_urls = ["${local.mcp_oauth_api_base_url}/mcp/oauth/callback"]
  logout_urls   = [local.mcp_oauth_api_base_url]

  access_token_validity = 1
  id_token_validity     = 1

  token_validity_units {
    access_token = "hours"
    id_token     = "hours"
  }
}

resource "aws_cognito_user_pool_ui_customization" "mcp_oauth" {
  user_pool_id = var.user_pool_id
  client_id    = aws_cognito_user_pool_client.mcp_oauth.id
  image_file   = fileexists(local.mcp_oauth_logo_path) ? filebase64(local.mcp_oauth_logo_path) : null

  css = <<-CSS
    .background-customizable {
      background-color: #080808;
    }

    .banner-customizable {
      background-color: #080808;
      padding: 32px 0 18px;
    }

    .label-customizable {
      color: #f5f5f5;
    }

    .legalText-customizable {
      color: #f5f5f5;
    }

    .inputField-customizable {
      background-color: #232323;
      border: 1px solid #555555;
      border-radius: 8px;
      color: #ffffff;
      min-height: 48px;
    }

    .inputField-customizable:focus {
      border-color: #d8d8d8;
      box-shadow: 0 0 0 3px rgba(216, 216, 216, 0.2);
    }

    .submitButton-customizable {
      background-color: #f4f4f4;
      border: 0;
      border-radius: 8px;
      color: #111111;
      font-weight: 700;
      min-height: 48px;
    }

    .submitButton-customizable:hover {
      background-color: #ffffff;
    }
  CSS
}

# The shared-role DynamoDB grant for the revocations table moved to
# aws_iam_policy.api_data_plane in iam-grouped.tf (R9).
