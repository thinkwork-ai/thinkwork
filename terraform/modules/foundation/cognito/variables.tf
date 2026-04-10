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

variable "existing_hive_client_id" {
  description = "App client ID for the web admin client (required when create_cognito = false)"
  type        = string
  default     = null
}

variable "existing_hive_app_client_id" {
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

variable "pre_signup_lambda_zip" {
  description = "Path to the pre-signup Lambda zip file"
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Callback URLs (configurable per deployment)
# ---------------------------------------------------------------------------

variable "hive_callback_urls" {
  description = "OAuth callback URLs for the web admin client"
  type        = list(string)
  default = [
    "http://localhost:5174",
    "http://localhost:5174/auth/callback",
  ]
}

variable "hive_logout_urls" {
  description = "OAuth logout URLs for the web admin client"
  type        = list(string)
  default = [
    "http://localhost:5174",
  ]
}

variable "mobile_callback_urls" {
  description = "OAuth callback URLs for the mobile client"
  type        = list(string)
  default = [
    "exp://localhost:8081",
    "thinkwork://",
    "thinkwork://auth/callback",
  ]
}

variable "mobile_logout_urls" {
  description = "OAuth logout URLs for the mobile client"
  type        = list(string)
  default = [
    "exp://localhost:8081",
    "thinkwork://",
  ]
}
