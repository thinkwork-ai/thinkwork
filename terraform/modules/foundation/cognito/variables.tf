variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# ---------------------------------------------------------------------------
# BYO Cognito
# ---------------------------------------------------------------------------

variable "create_cognito" {
  description = "Whether to create a new Cognito user pool. Set to false to use an existing pool."
  type        = bool
  default     = true
}

variable "existing_user_pool_id" {
  description = "ID of an existing Cognito user pool (required when create_cognito = false)"
  type        = string
  default     = null
}

variable "existing_user_pool_arn" {
  description = "ARN of an existing Cognito user pool (required when create_cognito = false)"
  type        = string
  default     = null
}

variable "existing_admin_client_id" {
  description = "App client ID for the web admin client (required when create_cognito = false)"
  type        = string
  default     = null
}

variable "existing_mobile_client_id" {
  description = "App client ID for the mobile client (required when create_cognito = false)"
  type        = string
  default     = null
}

variable "existing_identity_pool_id" {
  description = "ID of an existing identity pool (required when create_cognito = false)"
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# User Pool Configuration (only used when create_cognito = true)
# ---------------------------------------------------------------------------

variable "user_pool_name" {
  description = "Override the user pool name (defaults to thinkwork-<stage>-user-pool)"
  type        = string
  default     = ""
}

variable "email_source_arn" {
  description = "SES identity ARN Cognito should use for user-pool emails. Leave empty to use Cognito's default sender."
  type        = string
  default     = ""
}

variable "from_email_address" {
  description = "Optional Cognito From header, for example 'ThinkWork <noreply@example.com>'. Requires email_source_arn when set."
  type        = string
  default     = ""
}

variable "reply_to_email_address" {
  description = "Optional Cognito Reply-To address for user-pool emails."
  type        = string
  default     = ""
}

variable "invite_email_subject" {
  description = "Subject line for Cognito AdminCreateUser invitation emails."
  type        = string
  default     = "You're invited to ThinkWork"
}

variable "invite_email_message" {
  description = "HTML invitation body for Cognito AdminCreateUser emails. Must include {username} and {####} so Cognito can send the temporary password."
  type        = string
  default     = <<-EOT
    <p>You have been invited to ThinkWork.</p>
    <p>Username: <strong>{username}</strong></p>
    <p>Temporary password: <strong>{####}</strong></p>
    <p>Sign in to your ThinkWork environment to finish setup.</p>
  EOT

  validation {
    condition     = strcontains(var.invite_email_message, "{username}") && strcontains(var.invite_email_message, "{####}")
    error_message = "invite_email_message must include Cognito placeholders {username} and {####}."
  }
}

variable "invite_sms_message" {
  description = "SMS invitation body for Cognito AdminCreateUser messages. Must include {username} and {####} so Cognito can send the temporary password."
  type        = string
  default     = "Your ThinkWork username is {username} and temporary password is {####}."

  validation {
    condition     = strcontains(var.invite_sms_message, "{username}") && strcontains(var.invite_sms_message, "{####}")
    error_message = "invite_sms_message must include Cognito placeholders {username} and {####}."
  }
}

variable "identity_pool_name" {
  description = "Override the identity pool name (defaults to thinkwork-<stage>-identity-pool)"
  type        = string
  default     = ""
}

variable "google_oauth_client_id" {
  description = "Google OAuth client ID for social login"
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "Google OAuth client secret for social login"
  type        = string
  sensitive   = true
  default     = ""
}

variable "microsoft_oauth_client_id" {
  description = "Microsoft Entra application client ID for the default tenant-specific OIDC route"
  type        = string
  default     = ""
}

variable "microsoft_oauth_client_secret" {
  description = "Microsoft Entra application client secret for the default tenant-specific OIDC route"
  type        = string
  sensitive   = true
  default     = ""
}

variable "microsoft_oauth_tenant" {
  description = "Microsoft Entra directory GUID used to build the exact OIDC issuer for the default Microsoft route"
  type        = string
  default     = ""

  validation {
    condition     = var.microsoft_oauth_tenant == "" || can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", var.microsoft_oauth_tenant))
    error_message = "microsoft_oauth_tenant must be an Entra directory GUID."
  }
}

variable "tenant_entra_connections" {
  description = "Safe metadata for tenant-specific Entra OIDC providers reconciled before Terraform creates their route clients. Contains no upstream secret values."
  type = list(object({
    connection_key = string
    tenant_id      = string
    provider_name  = string
    display_name   = string
  }))
  default = []

  validation {
    condition = alltrue([
      for connection in var.tenant_entra_connections :
      can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", connection.tenant_id)) &&
      can(regex("^Entra_[a-f0-9]{16}_[a-f0-9]{8}$", connection.provider_name)) &&
      connection.connection_key != "" && connection.display_name != ""
    ])
    error_message = "Every tenant Entra connection must use a GUID tenant_id, a deterministic Entra_<tenant>_<hash> provider name, and non-empty safe labels."
  }
}

variable "oidc_identity_providers" {
  description = "Additional Cognito OIDC identity providers. Secrets should be sourced from Secrets Manager/SSM by the caller, not committed to tfvars."
  type = list(object({
    provider_name    = string
    client_id        = string
    client_secret    = string
    issuer_url       = string
    authorize_scopes = optional(string, "openid email profile")
    authorize_url    = optional(string, "")
    token_url        = optional(string, "")
    attributes_url   = optional(string, "")
    jwks_uri         = optional(string, "")
    attribute_mapping = optional(object({
      email    = optional(string, "email")
      name     = optional(string, "name")
      username = optional(string, "sub")
    }), {})
  }))
  default = []
}

variable "saml_identity_providers" {
  description = "Additional Cognito SAML identity providers. Metadata URLs must be public HTTPS endpoints validated before Terraform."
  type = list(object({
    provider_name   = string
    metadata_url    = string
    idp_identifiers = optional(list(string), [])
    attribute_mapping = optional(object({
      email    = optional(string, "email")
      name     = optional(string, "name")
      username = optional(string, "NameID")
    }), {})
  }))
  default = []
}

variable "pre_signup_lambda_zip" {
  description = "Path to the pre-signup Lambda zip file"
  type        = string
  default     = ""
}

variable "auth_retirement_phase" {
  description = "Native-auth migration phase. Fresh deployments default to retired; coexistence/cutover are explicit upgrade-only rollback states."
  type        = string
  default     = "retired"

  validation {
    condition     = contains(["coexistence", "cutover", "retired"], var.auth_retirement_phase)
    error_message = "auth_retirement_phase must be coexistence, cutover, or retired."
  }
}

variable "custom_auth_lambda_zip" {
  description = "Local Cognito custom-auth rollback Lambda artifact used only before the retired phase."
  type        = string
  default     = ""
}

variable "custom_auth_lambda_s3_bucket" {
  description = "S3 bucket containing the Cognito custom-auth rollback Lambda artifact."
  type        = string
  default     = ""
}

variable "custom_auth_lambda_s3_key" {
  description = "S3 key for the Cognito custom-auth rollback Lambda artifact."
  type        = string
  default     = ""
}

variable "pre_token_generation_lambda_s3_bucket" {
  description = "S3 bucket containing the Cognito pre-token client-deny Lambda release artifact"
  type        = string
  default     = ""
}

variable "pre_token_generation_lambda_s3_key" {
  description = "S3 key for the Cognito pre-token client-deny Lambda release artifact"
  type        = string
  default     = ""
}

variable "denied_app_client_ids" {
  description = "Cognito app clients denied new and refresh token issuance during auth cutover"
  type        = list(string)
  default     = []
}

variable "api_auth_secret" {
  description = "Shared signing secret used by the pre-retirement custom-auth rollback Lambda"
  type        = string
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Callback URLs (configurable per deployment)
# ---------------------------------------------------------------------------

variable "admin_callback_urls" {
  description = "OAuth callback URLs for the web admin client (also used by `thinkwork login --stage <s>` — the CLI binds a loopback server on 127.0.0.1:42010 and must find that URL here for Cognito to accept the redirect)"
  type        = list(string)
  default = [
    "http://localhost:5174",
    "http://localhost:5174/auth/callback",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5174/auth/callback",
    "http://127.0.0.1:42010/callback",
    "http://localhost:42010/callback",
  ]
}

variable "admin_logout_urls" {
  description = "OAuth logout URLs for the web admin client"
  type        = list(string)
  default = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
  ]
}

variable "desktop_callback_urls" {
  description = "OAuth callback and logout URLs for the desktop client that reuses the ThinkworkAdmin public Cognito client."
  type        = list(string)
  default = [
    "thinkwork://oauth/callback",
    "thinkwork-dev://oauth/callback",
    "thinkwork-canary://oauth/callback",
  ]
}

variable "cli_callback_urls" {
  description = "OAuth loopback callbacks reserved for the CLI client family."
  type        = list(string)
  default = [
    "http://127.0.0.1:42010/callback",
    "http://localhost:42010/callback",
  ]
}

variable "cli_logout_urls" {
  description = "OAuth loopback logout destinations reserved for the CLI client family."
  type        = list(string)
  default = [
    "http://127.0.0.1:42010/callback",
    "http://localhost:42010/callback",
  ]
}

variable "existing_auth_route_clients" {
  description = "Safe route-client manifest when using a BYO Cognito pool. Keys use <family>:<route>."
  type = map(object({
    client_id           = string
    route_key           = string
    client_family       = string
    provider_names      = list(string)
    explicit_auth_flows = list(string)
    callback_urls       = list(string)
    logout_urls         = list(string)
    lifecycle_state     = string
  }))
  default = {}
}

variable "mobile_callback_urls" {
  description = "OAuth callback URLs for the mobile client. Host apps that embed the SDK register their own deep-link here. Proper per-host app client isolation is 0.3.0 work — this is the stopgap capture of the drift from the CLI-applied URIs."
  type        = list(string)
  default = [
    "exp://localhost:8081",
    "thinkwork://",
    "thinkwork://auth/callback",
    "myapp://",
    "myapp://oauth/callback",
  ]
}

variable "mobile_logout_urls" {
  description = "OAuth logout URLs for the mobile client. Host apps that embed the SDK register their own deep-link here (see `mobile_callback_urls` for rationale)."
  type        = list(string)
  default = [
    "exp://localhost:8081",
    "thinkwork://",
    "myapp://",
  ]
}
