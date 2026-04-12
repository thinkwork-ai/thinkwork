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

variable "database_engine" {
  description = "Database engine: 'aurora-serverless' (production) or 'rds-postgres' (dev/test, cheaper)"
  type        = string
  default     = "aurora-serverless"
}

variable "enable_hindsight" {
  description = "Enable Hindsight long-term memory as an optional add-on alongside the always-on AgentCore managed memory. When true, deploys an ECS+ALB service for semantic/entity-graph/cross-encoder retrieval. Default false."
  type        = bool
  default     = false
}

variable "memory_engine" {
  description = "DEPRECATED. Use `enable_hindsight` instead. For backwards compatibility, setting this to 'hindsight' is equivalent to `enable_hindsight = true`. AgentCore managed memory is always on and cannot be disabled."
  type        = string
  default     = ""

  validation {
    condition     = var.memory_engine == "" || contains(["managed", "hindsight"], var.memory_engine)
    error_message = "memory_engine (deprecated) must be empty, 'managed', or 'hindsight'. Prefer enable_hindsight instead."
  }
}

variable "hindsight_image_tag" {
  description = "Hindsight Docker image tag (only used when enable_hindsight = true)"
  type        = string
  default     = "0.5.0"
}

variable "agentcore_memory_id" {
  description = "Optional pre-existing AgentCore Memory resource ID. When set, the agentcore-memory module skips provisioning and reuses this ID. Leave empty to auto-provision."
  type        = string
  default     = ""
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

variable "lambda_zips_dir" {
  description = "Local directory containing Lambda zip artifacts (from scripts/build-lambdas.sh). Enables real handlers when set."
  type        = string
  default     = ""
}

variable "api_auth_secret" {
  description = "Shared secret for inter-service API authentication"
  type        = string
  sensitive   = true
  default     = ""
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

# ---------------------------------------------------------------------------
# Docs site (custom domain — optional)
# ---------------------------------------------------------------------------

variable "docs_domain" {
  description = "Custom domain for the docs site (e.g. docs.thinkwork.ai). Leave empty for CloudFront default."
  type        = string
  default     = ""
}

variable "docs_certificate_arn" {
  description = "ACM certificate ARN for the docs domain (us-east-1, required for CloudFront custom domains)"
  type        = string
  default     = ""
}
