################################################################################
# Cognito — Foundation Module
#
# Creates a Cognito user pool with Google social login, two app clients
# (web admin + mobile), an identity pool, and user groups.
# Or accepts an existing pool via BYO variables.
################################################################################

locals {
  create = var.create_cognito

  user_pool_id       = local.create ? aws_cognito_user_pool.main[0].id : var.existing_user_pool_id
  user_pool_arn      = local.create ? aws_cognito_user_pool.main[0].arn : var.existing_user_pool_arn
  hive_client_id     = local.create ? aws_cognito_user_pool_client.hive[0].id : var.existing_hive_client_id
  hive_app_client_id = local.create ? aws_cognito_user_pool_client.hive_app[0].id : var.existing_hive_app_client_id
  identity_pool_id   = local.create ? aws_cognito_identity_pool.main[0].id : var.existing_identity_pool_id
}

data "aws_caller_identity" "current" {}

################################################################################
# Pre Sign-Up Lambda
################################################################################

resource "aws_iam_role" "pre_signup" {
  count = local.create ? 1 : 0
  name  = "thinkwork-${var.stage}-cognito-pre-signup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "pre_signup_basic" {
  count      = local.create ? 1 : 0
  role       = aws_iam_role.pre_signup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "pre_signup_cognito" {
  count = local.create ? 1 : 0
  name  = "cognito-access"
  role  = aws_iam_role.pre_signup[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cognito-idp:ListUsers",
        "cognito-idp:AdminLinkProviderForUser",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminSetUserPassword"
      ]
      Resource = aws_cognito_user_pool.main[0].arn
    }]
  })
}

resource "aws_lambda_function" "pre_signup" {
  count         = local.create ? 1 : 0
  function_name = "thinkwork-${var.stage}-cognito-pre-signup"
  filename      = var.pre_signup_lambda_zip
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10
  role          = aws_iam_role.pre_signup[0].arn

  source_code_hash = filebase64sha256(var.pre_signup_lambda_zip)
}

resource "aws_lambda_permission" "cognito_pre_signup" {
  count         = local.create ? 1 : 0
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_signup[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main[0].arn
}

################################################################################
# User Pool
################################################################################

resource "aws_cognito_user_pool" "main" {
  count = local.create ? 1 : 0
  name  = var.user_pool_name != "" ? var.user_pool_name : "thinkwork-${var.stage}-user-pool"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                = "tenant_id"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 0
      max_length = 36
    }
  }

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.pre_signup[0].arn
  }

  tags = {
    Name = "thinkwork-${var.stage}-user-pool"
  }

  lifecycle {
    ignore_changes = [schema]
  }
}

################################################################################
# Cognito Domain
################################################################################

resource "aws_cognito_user_pool_domain" "main" {
  count        = local.create ? 1 : 0
  domain       = "thinkwork-${var.stage}"
  user_pool_id = aws_cognito_user_pool.main[0].id
}

################################################################################
# Google Identity Provider
################################################################################

resource "aws_cognito_identity_provider" "google" {
  count         = local.create && var.google_oauth_client_id != "" ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.main[0].id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id                     = var.google_oauth_client_id
    client_secret                 = var.google_oauth_client_secret
    authorize_scopes              = "openid email profile"
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = true
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }
}

locals {
  identity_providers = var.google_oauth_client_id != "" ? ["Google", "COGNITO"] : ["COGNITO"]
}

################################################################################
# App Client — Hive (Web Admin)
################################################################################

resource "aws_cognito_user_pool_client" "hive" {
  count        = local.create ? 1 : 0
  name         = "Hive"
  user_pool_id = aws_cognito_user_pool.main[0].id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  supported_identity_providers = local.identity_providers

  callback_urls = var.hive_callback_urls
  logout_urls   = var.hive_logout_urls

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  read_attributes = [
    "email",
    "email_verified",
    "name",
    "custom:tenant_id",
  ]

  write_attributes = [
    "email",
    "name",
    "custom:tenant_id",
  ]

  depends_on = [aws_cognito_identity_provider.google]
}

################################################################################
# App Client — Mobile
################################################################################

resource "aws_cognito_user_pool_client" "hive_app" {
  count        = local.create ? 1 : 0
  name         = "ThinkworkMobile"
  user_pool_id = aws_cognito_user_pool.main[0].id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  supported_identity_providers = local.identity_providers

  callback_urls = var.mobile_callback_urls
  logout_urls   = var.mobile_logout_urls

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 90

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  read_attributes = [
    "email",
    "email_verified",
    "name",
    "custom:tenant_id",
  ]

  write_attributes = [
    "email",
    "name",
    "custom:tenant_id",
  ]

  depends_on = [aws_cognito_identity_provider.google]
}

################################################################################
# Identity Pool
################################################################################

resource "aws_cognito_identity_pool" "main" {
  count                            = local.create ? 1 : 0
  identity_pool_name               = var.identity_pool_name != "" ? var.identity_pool_name : "thinkwork-${var.stage}-identity-pool"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.hive[0].id
    provider_name           = "cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main[0].id}"
    server_side_token_check = false
  }

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.hive_app[0].id
    provider_name           = "cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main[0].id}"
    server_side_token_check = false
  }

  tags = {
    Name = "thinkwork-${var.stage}-identity-pool"
  }
}

################################################################################
# Identity Pool — Authenticated Role
################################################################################

resource "aws_iam_role" "authenticated" {
  count = local.create ? 1 : 0
  name  = "thinkwork-${var.stage}-cognito-authenticated"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "cognito-identity.amazonaws.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.main[0].id
        }
        "ForAnyValue:StringLike" = {
          "cognito-identity.amazonaws.com:amr" = "authenticated"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "authenticated_appsync" {
  count = local.create ? 1 : 0
  name  = "appsync-access"
  role  = aws_iam_role.authenticated[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "appsync:GraphQL"
      Resource = "*"
    }]
  })
}

resource "aws_cognito_identity_pool_roles_attachment" "main" {
  count            = local.create ? 1 : 0
  identity_pool_id = aws_cognito_identity_pool.main[0].id

  roles = {
    authenticated = aws_iam_role.authenticated[0].arn
  }
}

################################################################################
# User Groups
################################################################################

resource "aws_cognito_user_group" "groups" {
  for_each = local.create ? toset(["owner", "admin", "member", "viewer"]) : toset([])

  name         = each.key
  user_pool_id = aws_cognito_user_pool.main[0].id
  description  = "${title(each.key)} group"
}
