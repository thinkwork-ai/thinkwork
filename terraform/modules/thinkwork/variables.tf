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
  description = "Active long-term memory engine for canonical recall/inspect/export. Exactly one engine is authoritative per deployment. Accepted values: 'hindsight' (requires enable_hindsight = true), 'agentcore' (uses the always-on AgentCore managed memory). Legacy value 'managed' maps to 'agentcore'. Empty = auto-select: 'hindsight' when enable_hindsight = true, otherwise 'agentcore'."
  type        = string
  default     = ""

  validation {
    condition     = var.memory_engine == "" || contains(["managed", "hindsight", "agentcore"], var.memory_engine)
    error_message = "memory_engine must be empty, 'hindsight', 'agentcore', or legacy 'managed'."
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

# ---------------------------------------------------------------------------
# Public website (custom domain — optional)
# ---------------------------------------------------------------------------

variable "www_domain" {
  description = "Custom domain for the public website (e.g. thinkwork.ai). Leave empty for CloudFront default."
  type        = string
  default     = ""
}

variable "www_certificate_arn" {
  description = "ACM certificate ARN for the www domain (us-east-1, required for CloudFront custom domains). Covers both the apex and www subdomain."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Admin site (custom domain — optional)
# ---------------------------------------------------------------------------

variable "admin_domain" {
  description = "Custom domain for the admin SPA (e.g. admin.thinkwork.ai). Leave empty for CloudFront default."
  type        = string
  default     = ""
}

variable "admin_certificate_arn" {
  description = "ACM certificate ARN for the admin domain (us-east-1, required for CloudFront custom domains)."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# SES inbound email (delegated subzone — Option A)
# ---------------------------------------------------------------------------

variable "ses_inbound_domain" {
  description = "Subdomain used for agent email (e.g. agents.thinkwork.ai). Terraform creates a delegated Route53 hosted zone for this name, manages the SES domain identity + DKIM CNAMEs + MX in that zone, and wires an SES receipt rule that stores inbound mail in S3 and invokes the email-inbound Lambda. Leave empty to skip all SES inbound resources. After first apply, paste the `ses_inbound_name_servers` output as NS records at whatever hosts the parent domain."
  type        = string
  default     = ""
}

variable "ses_manage_active_rule_set" {
  description = "Activate the SES receipt rule set. Only ONE rule set can be active per region per AWS account; set false on secondary stages that share an account so they don't fight over activation."
  type        = bool
  default     = true
}

variable "lastmile_tasks_api_url" {
  description = "Base URL of the LastMile Tasks REST API (e.g. https://api-dev.lastmile-tei.com for develop). Feature-flags the outbound task sync — leave blank to keep mobile-created tasks in sync_status='local'."
  type        = string
  default     = ""
}
