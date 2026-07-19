################################################################################
# Cognito — Foundation Module
#
# Creates a Cognito user pool with Google social login, two app clients
# (web admin + mobile), an identity pool, and user groups.
# Or accepts an existing pool via BYO variables.
################################################################################

locals {
  create                          = var.create_cognito
  create_pre_signup               = local.create && var.pre_signup_lambda_zip != ""
  create_pre_token_generation     = local.create && trimspace(var.pre_token_generation_lambda_s3_bucket) != "" && trimspace(var.pre_token_generation_lambda_s3_key) != ""
  workos_rollback_enabled         = var.auth_retirement_phase != "retired"
  use_local_custom_auth_artifact  = trimspace(var.custom_auth_lambda_zip) != ""
  use_remote_custom_auth_artifact = trimspace(var.custom_auth_lambda_s3_bucket) != ""
  custom_auth_artifact_count      = (local.use_local_custom_auth_artifact ? 1 : 0) + (local.use_remote_custom_auth_artifact ? 1 : 0)
  create_custom_auth              = local.create && local.workos_rollback_enabled && local.custom_auth_artifact_count == 1

  user_pool_id  = local.create ? aws_cognito_user_pool.main[0].id : var.existing_user_pool_id
  user_pool_arn = local.create ? aws_cognito_user_pool.main[0].arn : var.existing_user_pool_arn
  admin_client_id = local.create ? (
    local.workos_rollback_enabled ? aws_cognito_user_pool_client.admin[0].id : aws_cognito_user_pool_client.auth_route["web:local"].id
  ) : var.existing_admin_client_id
  mobile_client_id = local.create ? (
    local.workos_rollback_enabled ? aws_cognito_user_pool_client.mobile[0].id : aws_cognito_user_pool_client.auth_route["mobile:local"].id
  ) : var.existing_mobile_client_id
  identity_pool_id = local.create ? aws_cognito_identity_pool.main[0].id : var.existing_identity_pool_id
  oidc_identity_providers = {
    for provider in var.oidc_identity_providers : provider.provider_name => provider
  }
  saml_identity_providers = {
    for provider in var.saml_identity_providers : provider.provider_name => provider
  }
  auth_client_families = {
    web = {
      callback_urls      = [for url in var.admin_callback_urls : url if !strcontains(url, ":42010/")]
      logout_urls        = var.admin_logout_urls
      refresh_token_days = 30
    }
    mobile = {
      callback_urls      = var.mobile_callback_urls
      logout_urls        = var.mobile_logout_urls
      refresh_token_days = 90
    }
    desktop = {
      callback_urls      = var.desktop_callback_urls
      logout_urls        = var.desktop_callback_urls
      refresh_token_days = 30
    }
    cli = {
      callback_urls      = var.cli_callback_urls
      logout_urls        = var.cli_logout_urls
      refresh_token_days = 30
    }
  }
  static_auth_routes = merge(
    {
      for family, config in local.auth_client_families : "${family}:local" => {
        route_key           = "local"
        client_family       = family
        provider_names      = ["COGNITO"]
        explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
        callback_urls       = config.callback_urls
        logout_urls         = config.logout_urls
        refresh_token_days  = config.refresh_token_days
      }
    },
    var.google_oauth_client_id != "" ? {
      for family, config in local.auth_client_families : "${family}:google" => {
        route_key           = "google"
        client_family       = family
        provider_names      = ["Google"]
        explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]
        callback_urls       = config.callback_urls
        logout_urls         = config.logout_urls
        refresh_token_days  = config.refresh_token_days
      }
    } : {},
    var.microsoft_oauth_client_id != "" ? {
      for family, config in local.auth_client_families : "${family}:microsoft" => {
        route_key           = "microsoft"
        client_family       = family
        provider_names      = ["MicrosoftOrganizations"]
        explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]
        callback_urls       = config.callback_urls
        logout_urls         = config.logout_urls
        refresh_token_days  = config.refresh_token_days
      }
    } : {},
  )
  tenant_auth_routes = merge({}, [
    for connection in var.tenant_entra_connections : {
      for family, config in local.auth_client_families : "${family}:entra:${lower(connection.tenant_id)}" => {
        route_key           = "entra-${replace(lower(connection.tenant_id), "-", "")}"
        client_family       = family
        provider_names      = [connection.provider_name]
        explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]
        callback_urls       = config.callback_urls
        logout_urls         = config.logout_urls
        refresh_token_days  = config.refresh_token_days
      }
    }
  ]...)
  auth_routes = merge(local.static_auth_routes, local.tenant_auth_routes)
}

resource "terraform_data" "custom_auth_artifact_validation" {
  input = {
    phase          = var.auth_retirement_phase
    artifact_count = local.custom_auth_artifact_count
  }

  lifecycle {
    precondition {
      condition     = local.custom_auth_artifact_count <= 1
      error_message = "Set only one Cognito custom-auth Lambda artifact source: custom_auth_lambda_zip or custom_auth_lambda_s3_bucket/custom_auth_lambda_s3_key."
    }

    precondition {
      condition     = !local.use_remote_custom_auth_artifact || trimspace(var.custom_auth_lambda_s3_key) != ""
      error_message = "custom_auth_lambda_s3_key must be set when custom_auth_lambda_s3_bucket is set."
    }

    precondition {
      condition     = !local.create_custom_auth || var.api_auth_secret != ""
      error_message = "The WorkOS rollback custom-auth Lambda requires api_auth_secret until auth_retirement_phase is retired."
    }

    precondition {
      condition     = var.microsoft_oauth_client_id == "" || var.microsoft_oauth_tenant != ""
      error_message = "microsoft_oauth_tenant is required when microsoft_oauth_client_id is configured because Cognito requires an exact tenant issuer."
    }
  }
}

data "aws_caller_identity" "current" {}

################################################################################
# Pre Sign-Up Lambda
################################################################################

resource "aws_iam_role" "pre_signup" {
  count = local.create_pre_signup ? 1 : 0
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
  count      = local.create_pre_signup ? 1 : 0
  role       = aws_iam_role.pre_signup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "pre_signup" {
  count         = local.create_pre_signup ? 1 : 0
  function_name = "thinkwork-${var.stage}-cognito-pre-signup"
  filename      = var.pre_signup_lambda_zip
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10
  role          = aws_iam_role.pre_signup[0].arn

  source_code_hash = filebase64sha256(var.pre_signup_lambda_zip)
}

resource "aws_lambda_permission" "cognito_pre_signup" {
  count         = local.create_pre_signup ? 1 : 0
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_signup[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main[0].arn
}

################################################################################
# Pre Token Generation Client Cutoff Lambda
################################################################################

resource "aws_iam_role" "pre_token_generation" {
  count = local.create_pre_token_generation ? 1 : 0
  name  = "thinkwork-${var.stage}-cognito-pre-token-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "pre_token_generation_basic" {
  count      = local.create_pre_token_generation ? 1 : 0
  role       = aws_iam_role.pre_token_generation[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "pre_token_generation" {
  count         = local.create_pre_token_generation ? 1 : 0
  function_name = "thinkwork-${var.stage}-cognito-pre-token-client-deny"
  s3_bucket     = var.pre_token_generation_lambda_s3_bucket
  s3_key        = var.pre_token_generation_lambda_s3_key
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 5
  role          = aws_iam_role.pre_token_generation[0].arn

  environment {
    variables = {
      COGNITO_DENIED_APP_CLIENT_IDS = join(",", var.denied_app_client_ids)
    }
  }
}

resource "aws_lambda_permission" "cognito_pre_token_generation" {
  count         = local.create_pre_token_generation ? 1 : 0
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_token_generation[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main[0].arn
}

################################################################################
# Legacy WorkOS Custom Auth Challenge Lambda (rollback runtime only)
################################################################################

resource "aws_iam_role" "custom_auth" {
  count = local.create_custom_auth ? 1 : 0
  name  = local.use_remote_custom_auth_artifact ? "thinkwork-${var.stage}-cognito-custom-auth-release-role" : "thinkwork-${var.stage}-cognito-custom-auth-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "custom_auth_basic" {
  count      = local.create_custom_auth ? 1 : 0
  role       = aws_iam_role.custom_auth[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "custom_auth" {
  count         = local.create_custom_auth ? 1 : 0
  function_name = local.use_remote_custom_auth_artifact ? "thinkwork-${var.stage}-cognito-custom-auth-release" : "thinkwork-${var.stage}-cognito-custom-auth"
  filename      = local.use_local_custom_auth_artifact ? var.custom_auth_lambda_zip : null
  s3_bucket     = local.use_remote_custom_auth_artifact ? var.custom_auth_lambda_s3_bucket : null
  s3_key        = local.use_remote_custom_auth_artifact ? var.custom_auth_lambda_s3_key : null
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10
  role          = aws_iam_role.custom_auth[0].arn

  environment {
    variables = {
      API_AUTH_SECRET = var.api_auth_secret
    }
  }

  source_code_hash = local.use_local_custom_auth_artifact ? filebase64sha256(var.custom_auth_lambda_zip) : null
}

resource "aws_lambda_permission" "cognito_custom_auth" {
  count         = local.create_custom_auth ? 1 : 0
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.custom_auth[0].function_name
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

  email_configuration {
    email_sending_account  = var.email_source_arn != "" ? "DEVELOPER" : "COGNITO_DEFAULT"
    source_arn             = var.email_source_arn != "" ? var.email_source_arn : null
    from_email_address     = var.from_email_address != "" ? var.from_email_address : null
    reply_to_email_address = var.reply_to_email_address != "" ? var.reply_to_email_address : null
  }

  admin_create_user_config {
    allow_admin_create_user_only = false

    invite_message_template {
      email_subject = var.invite_email_subject
      email_message = var.invite_email_message
      sms_message   = var.invite_sms_message
    }
  }

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
    name                = "entra_tenant_id"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 0
      max_length = 36
    }
  }

  schema {
    name                = "entra_object_id"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 0
      max_length = 36
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

  dynamic "lambda_config" {
    for_each = local.create_pre_signup || local.create_pre_token_generation || local.create_custom_auth ? [1] : []
    content {
      pre_sign_up                    = local.create_pre_signup ? aws_lambda_function.pre_signup[0].arn : null
      define_auth_challenge          = local.create_custom_auth ? aws_lambda_function.custom_auth[0].arn : null
      create_auth_challenge          = local.create_custom_auth ? aws_lambda_function.custom_auth[0].arn : null
      verify_auth_challenge_response = local.create_custom_auth ? aws_lambda_function.custom_auth[0].arn : null
      dynamic "pre_token_generation_config" {
        for_each = local.create_pre_token_generation ? [1] : []
        content {
          lambda_arn     = aws_lambda_function.pre_token_generation[0].arn
          lambda_version = "V2_0"
        }
      }
    }
  }

  tags = {
    Name = "thinkwork-${var.stage}-user-pool"
  }

  lifecycle {
    ignore_changes = [schema]

    precondition {
      condition     = var.from_email_address == "" || var.email_source_arn != ""
      error_message = "from_email_address requires email_source_arn so Cognito can use a verified SES identity."
    }
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

resource "aws_cognito_identity_provider" "microsoft_organizations" {
  count         = local.create && var.microsoft_oauth_client_id != "" ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.main[0].id
  provider_name = "MicrosoftOrganizations"
  provider_type = "OIDC"

  provider_details = {
    client_id                 = var.microsoft_oauth_client_id
    client_secret             = var.microsoft_oauth_client_secret
    authorize_scopes          = "openid email profile"
    oidc_issuer               = "https://login.microsoftonline.com/${lower(var.microsoft_oauth_tenant)}/v2.0"
    attributes_request_method = "GET"
  }

  attribute_mapping = {
    # Entra v2 does not guarantee an `email` claim for every work/school
    # account. `preferred_username` is the supported sign-in hint and keeps
    # Cognito's required email attribute populated as a stable normalized
    # correlation value. ThinkWork only consults it after
    # Cognito validates this exact Entra route; ongoing admission uses the
    # immutable Cognito issuer/subject binding created by that first login.
    email                    = "preferred_username"
    name                     = "name"
    username                 = "sub"
    "custom:entra_tenant_id" = "tid"
    "custom:entra_object_id" = "oid"
  }
}

locals {
  identity_providers = concat(
    var.google_oauth_client_id != "" ? ["Google"] : [],
    var.microsoft_oauth_client_id != "" ? ["MicrosoftOrganizations"] : [],
    keys(local.oidc_identity_providers),
    keys(local.saml_identity_providers),
    ["COGNITO"]
  )
}

################################################################################
# Route-specific public app clients
################################################################################

resource "aws_cognito_user_pool_client" "auth_route" {
  for_each = local.create ? local.auth_routes : {}

  name         = "Thinkwork-${title(each.value.client_family)}-${title(each.value.route_key)}"
  user_pool_id = aws_cognito_user_pool.main[0].id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  explicit_auth_flows                  = each.value.explicit_auth_flows
  supported_identity_providers         = each.value.provider_names
  callback_urls                        = distinct(each.value.callback_urls)
  logout_urls                          = distinct(each.value.logout_urls)
  enable_token_revocation              = true
  prevent_user_existence_errors        = "ENABLED"
  access_token_validity                = 1
  id_token_validity                    = 1
  refresh_token_validity               = each.value.refresh_token_days

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
    "custom:entra_tenant_id",
    "custom:entra_object_id",
  ]

  write_attributes = [
    "email",
    "name",
    "custom:tenant_id",
    "custom:entra_tenant_id",
    "custom:entra_object_id",
  ]

  depends_on = [
    aws_cognito_identity_provider.google,
    aws_cognito_identity_provider.microsoft_organizations,
    aws_cognito_identity_provider.oidc,
    aws_cognito_identity_provider.saml,
  ]
}

resource "aws_cognito_identity_provider" "oidc" {
  for_each = local.create ? local.oidc_identity_providers : {}

  user_pool_id  = aws_cognito_user_pool.main[0].id
  provider_name = each.value.provider_name
  provider_type = "OIDC"

  provider_details = merge(
    {
      client_id                 = each.value.client_id
      client_secret             = each.value.client_secret
      authorize_scopes          = each.value.authorize_scopes
      oidc_issuer               = each.value.issuer_url
      token_request_method      = "POST"
      attributes_request_method = "GET"
    },
    each.value.authorize_url != "" ? { authorize_url = each.value.authorize_url } : {},
    each.value.token_url != "" ? { token_url = each.value.token_url } : {},
    each.value.attributes_url != "" ? { attributes_url = each.value.attributes_url } : {},
    each.value.jwks_uri != "" ? { jwks_uri = each.value.jwks_uri } : {}
  )

  attribute_mapping = {
    email    = each.value.attribute_mapping.email
    name     = each.value.attribute_mapping.name
    username = each.value.attribute_mapping.username
  }
}

resource "aws_cognito_identity_provider" "saml" {
  for_each = local.create ? local.saml_identity_providers : {}

  user_pool_id     = aws_cognito_user_pool.main[0].id
  provider_name    = each.value.provider_name
  provider_type    = "SAML"
  idp_identifiers  = each.value.idp_identifiers
  provider_details = { MetadataURL = each.value.metadata_url }

  attribute_mapping = {
    email    = each.value.attribute_mapping.email
    name     = each.value.attribute_mapping.name
    username = each.value.attribute_mapping.username
  }
}

################################################################################
# App Client — Admin (Web)
################################################################################

resource "aws_cognito_user_pool_client" "admin" {
  count        = local.create && local.workos_rollback_enabled ? 1 : 0
  name         = "ThinkworkAdminLegacy"
  user_pool_id = aws_cognito_user_pool.main[0].id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  explicit_auth_flows = [
    "ALLOW_CUSTOM_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  supported_identity_providers = local.identity_providers

  callback_urls = distinct(concat(var.admin_callback_urls, var.desktop_callback_urls, var.cli_callback_urls))
  logout_urls   = distinct(concat(var.admin_logout_urls, var.desktop_callback_urls, var.cli_logout_urls))

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

  depends_on = [
    aws_cognito_identity_provider.google,
    aws_cognito_identity_provider.oidc,
    aws_cognito_identity_provider.saml,
  ]
}

################################################################################
# App Client — Mobile
################################################################################

resource "aws_cognito_user_pool_client" "mobile" {
  count        = local.create && local.workos_rollback_enabled ? 1 : 0
  name         = "ThinkworkMobileLegacy"
  user_pool_id = aws_cognito_user_pool.main[0].id

  explicit_auth_flows = [
    "ALLOW_CUSTOM_AUTH",
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

  depends_on = [
    aws_cognito_identity_provider.google,
    aws_cognito_identity_provider.oidc,
    aws_cognito_identity_provider.saml,
  ]
}

################################################################################
# Identity Pool
################################################################################

resource "aws_cognito_identity_pool" "main" {
  count                            = local.create ? 1 : 0
  identity_pool_name               = var.identity_pool_name != "" ? var.identity_pool_name : "thinkwork-${var.stage}-identity-pool"
  allow_unauthenticated_identities = false

  dynamic "cognito_identity_providers" {
    for_each = local.workos_rollback_enabled ? {
      admin  = aws_cognito_user_pool_client.admin[0].id
      mobile = aws_cognito_user_pool_client.mobile[0].id
    } : {}
    content {
      client_id               = cognito_identity_providers.value
      provider_name           = "cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main[0].id}"
      server_side_token_check = false
    }
  }

  dynamic "cognito_identity_providers" {
    for_each = aws_cognito_user_pool_client.auth_route
    content {
      client_id               = cognito_identity_providers.value.id
      provider_name           = "cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main[0].id}"
      server_side_token_check = true
    }
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
