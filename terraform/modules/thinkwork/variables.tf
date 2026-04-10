################################################################################
# Thinkwork Composite Root — Variables
#
# This is the friendly front door: `thinkwork-ai/thinkwork/aws` on the
# Terraform Registry. It wires the three tiers (foundation, data, app)
# together with sensible defaults. Advanced users can compose sub-modules
# directly instead.
################################################################################

# ---------------------------------------------------------------------------
# Required
# ---------------------------------------------------------------------------

variable "stage" {
  description = "Deployment stage (e.g. dev, prod). Must match the Terraform workspace name."
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

# ---------------------------------------------------------------------------
# Secrets (populate via SSM data sources or tfvars)
# ---------------------------------------------------------------------------

variable "db_password" {
  description = "Master password for the Aurora cluster"
  type        = string
  sensitive   = true
}

variable "google_oauth_client_id" {
  description = "Google OAuth client ID for Cognito social login (optional)"
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# BYO Foundation (all optional — defaults to creating everything)
# ---------------------------------------------------------------------------

variable "create_vpc" {
  description = "Create a new VPC (false = BYO)"
  type        = bool
  default     = true
}

variable "existing_vpc_id" {
  type    = string
  default = null
}

variable "existing_public_subnet_ids" {
  type    = list(string)
  default = []
}

variable "existing_private_subnet_ids" {
  type    = list(string)
  default = []
}

variable "create_cognito" {
  description = "Create a new Cognito user pool (false = BYO)"
  type        = bool
  default     = true
}

variable "existing_user_pool_id" {
  type    = string
  default = null
}

variable "existing_user_pool_arn" {
  type    = string
  default = null
}

variable "existing_admin_client_id" {
  type    = string
  default = null
}

variable "existing_mobile_client_id" {
  type    = string
  default = null
}

variable "existing_identity_pool_id" {
  type    = string
  default = null
}

variable "create_database" {
  description = "Create a new Aurora cluster (false = BYO)"
  type        = bool
  default     = true
}

variable "existing_db_cluster_arn" {
  type    = string
  default = null
}

variable "existing_db_secret_arn" {
  type    = string
  default = null
}

variable "existing_db_endpoint" {
  type    = string
  default = null
}

variable "existing_db_security_group_id" {
  type    = string
  default = null
}

# ---------------------------------------------------------------------------
# Naming / Buckets
# ---------------------------------------------------------------------------

variable "bucket_name" {
  description = "Primary S3 bucket name"
  type        = string
  default     = ""
}

variable "database_name" {
  description = "Aurora database name"
  type        = string
  default     = "thinkwork"
}

# ---------------------------------------------------------------------------
# Lambda Artifacts
# ---------------------------------------------------------------------------

variable "lambda_artifact_bucket" {
  description = "S3 bucket containing Lambda deployment artifacts"
  type        = string
  default     = ""
}

variable "lambda_artifact_prefix" {
  description = "S3 key prefix for Lambda artifacts"
  type        = string
  default     = "latest/lambdas"
}

# ---------------------------------------------------------------------------
# Cognito Callback URLs (configurable per deployment)
# ---------------------------------------------------------------------------

variable "admin_callback_urls" {
  type    = list(string)
  default = ["http://localhost:5174", "http://localhost:5174/auth/callback"]
}

variable "admin_logout_urls" {
  type    = list(string)
  default = ["http://localhost:5174"]
}

variable "mobile_callback_urls" {
  type    = list(string)
  default = ["exp://localhost:8081", "thinkwork://", "thinkwork://auth/callback"]
}

variable "mobile_logout_urls" {
  type    = list(string)
  default = ["exp://localhost:8081", "thinkwork://"]
}

# ---------------------------------------------------------------------------
# Pre-signup Lambda
# ---------------------------------------------------------------------------

variable "pre_signup_lambda_zip" {
  description = "Path to the Cognito pre-signup Lambda zip"
  type        = string
  default     = ""
}
