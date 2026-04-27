locals {
  mcp_oauth_api_base_url       = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com"
  mcp_oauth_cognito_base_url   = var.cognito_auth_domain != "" ? "https://${var.cognito_auth_domain}.auth.${var.region}.amazoncognito.com" : ""
  mcp_oauth_identity_providers = var.google_oauth_client_id != "" ? ["Google", "COGNITO"] : ["COGNITO"]
  mcp_oauth_logo_path          = "${path.module}/../../../../apps/admin/public/logo.png"
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

resource "aws_iam_role_policy" "lambda_mcp_oauth_revocations" {
  name = "mcp-oauth-revocations"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem"
        ]
        Resource = aws_dynamodb_table.mcp_oauth_revocations.arn
      }
    ]
  })
}
