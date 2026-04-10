variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "lambda_artifact_bucket" {
  description = "S3 bucket containing Lambda deployment artifacts"
  type        = string
}

variable "lambda_artifact_prefix" {
  description = "S3 key prefix for Lambda artifacts (e.g. v0.1.0/lambdas)"
  type        = string
  default     = "latest/lambdas"
}

# ---------------------------------------------------------------------------
# Dependencies from other tiers
# ---------------------------------------------------------------------------

variable "db_cluster_arn" {
  description = "Aurora cluster ARN"
  type        = string
}

variable "graphql_db_secret_arn" {
  description = "Secrets Manager ARN for DB credentials"
  type        = string
}

variable "db_cluster_endpoint" {
  description = "Aurora cluster endpoint (hostname)"
  type        = string
  default     = ""
}

variable "database_name" {
  description = "Aurora database name"
  type        = string
  default     = "thinkwork"
}

variable "bucket_name" {
  description = "Primary S3 bucket name"
  type        = string
}

variable "bucket_arn" {
  description = "Primary S3 bucket ARN"
  type        = string
}

variable "user_pool_id" {
  description = "Cognito user pool ID"
  type        = string
}

variable "user_pool_arn" {
  description = "Cognito user pool ARN"
  type        = string
}

variable "admin_client_id" {
  description = "Cognito web admin client ID"
  type        = string
}

variable "mobile_client_id" {
  description = "Cognito mobile client ID"
  type        = string
}

variable "appsync_api_url" {
  description = "AppSync subscriptions endpoint URL"
  type        = string
}

variable "appsync_api_key" {
  description = "AppSync API key"
  type        = string
  sensitive   = true
}

variable "kb_service_role_arn" {
  description = "Bedrock Knowledge Base service role ARN"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for custom API domain"
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Custom domain for the API (e.g. api.thinkwork.ai). Leave empty to skip."
  type        = string
  default     = ""
}

variable "lambda_zips_dir" {
  description = "Local directory containing Lambda zip artifacts (from scripts/build-lambdas.sh). Set to enable real handlers."
  type        = string
  default     = ""
}

variable "db_password" {
  description = "Database password (used to construct DATABASE_URL for Lambda)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "thinkwork_admin"
}

variable "api_auth_secret" {
  description = "Shared secret for inter-service API authentication"
  type        = string
  sensitive   = true
  default     = ""
}

variable "agentcore_invoke_url" {
  description = "Lambda Function URL for AgentCore container invocation"
  type        = string
  default     = ""
}
