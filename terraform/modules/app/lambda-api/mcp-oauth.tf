locals {
  mcp_oauth_api_base_url       = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com"
  mcp_oauth_cognito_base_url   = var.cognito_auth_domain != "" ? "https://${var.cognito_auth_domain}.auth.${var.region}.amazoncognito.com" : ""
  mcp_oauth_identity_providers = var.google_oauth_client_id != "" ? ["Google", "COGNITO"] : ["COGNITO"]
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
