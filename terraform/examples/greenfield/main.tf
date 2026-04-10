################################################################################
# Greenfield Example
#
# Creates everything from scratch in a fresh AWS account.
# Copy this directory to start a new Thinkwork deployment.
#
# Usage:
#   cd terraform/examples/greenfield
#   cp terraform.tfvars.example terraform.tfvars  # edit with your values
#   terraform init
#   terraform workspace new dev                    # or your stage name
#   terraform plan -var-file=terraform.tfvars
#   terraform apply -var-file=terraform.tfvars
################################################################################

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }

  # For the example, use local state. Production deployments should
  # use S3 + DynamoDB backend — see the docs for configuration.
  # backend "s3" { ... }
}

provider "aws" {
  region = var.region
}

variable "stage" {
  description = "Deployment stage — must match the Terraform workspace name"
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

variable "db_password" {
  description = "Master password for the Aurora cluster"
  type        = string
  sensitive   = true
}

variable "database_engine" {
  description = "Database engine: 'aurora-serverless' (production) or 'rds-postgres' (dev/test, cheaper)"
  type        = string
  default     = "aurora-serverless"
}

variable "memory_engine" {
  description = "Memory engine: 'managed' (AgentCore built-in, default) or 'hindsight' (ECS+ALB, opt-in)"
  type        = string
  default     = "managed"
}

variable "google_oauth_client_id" {
  description = "Google OAuth client ID (optional — leave empty to skip Google login)"
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "pre_signup_lambda_zip" {
  description = "Path to the Cognito pre-signup Lambda zip"
  type        = string
  default     = ""
}

variable "lambda_zips_dir" {
  description = "Local directory containing Lambda zip artifacts (from pnpm build:lambdas)"
  type        = string
  default     = ""
}

variable "api_auth_secret" {
  description = "Shared secret for inter-service API authentication"
  type        = string
  sensitive   = true
  default     = ""
}

module "thinkwork" {
  source = "../../modules/thinkwork"

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  db_password                = var.db_password
  database_engine            = var.database_engine
  memory_engine              = var.memory_engine
  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  pre_signup_lambda_zip      = var.pre_signup_lambda_zip
  lambda_zips_dir            = var.lambda_zips_dir
  api_auth_secret            = var.api_auth_secret

  # Greenfield: create everything (all defaults are true)
}

################################################################################
# Outputs
################################################################################

output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.thinkwork.api_endpoint
}

output "appsync_realtime_url" {
  description = "AppSync realtime WebSocket URL (for frontend subscription clients)"
  value       = module.thinkwork.appsync_realtime_url
}

output "user_pool_id" {
  description = "Cognito user pool ID"
  value       = module.thinkwork.user_pool_id
}

output "admin_client_id" {
  description = "Cognito app client ID for web admin"
  value       = module.thinkwork.admin_client_id
}

output "mobile_client_id" {
  description = "Cognito app client ID for mobile"
  value       = module.thinkwork.mobile_client_id
}

output "ecr_repository_url" {
  description = "ECR repository URL for the AgentCore container"
  value       = module.thinkwork.ecr_repository_url
}

output "bucket_name" {
  description = "Primary S3 bucket"
  value       = module.thinkwork.bucket_name
}

output "db_cluster_endpoint" {
  description = "Aurora cluster endpoint"
  value       = module.thinkwork.db_cluster_endpoint
}

output "db_secret_arn" {
  description = "Secrets Manager ARN for database credentials"
  value       = module.thinkwork.db_secret_arn
}

output "database_name" {
  description = "Database name"
  value       = module.thinkwork.database_name
}

output "memory_engine" {
  description = "Active memory engine (managed or hindsight)"
  value       = module.thinkwork.memory_engine
}

output "hindsight_endpoint" {
  description = "Hindsight API endpoint (null when memory_engine = managed)"
  value       = module.thinkwork.hindsight_endpoint
}
