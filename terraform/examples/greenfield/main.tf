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
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket         = "thinkwork-terraform-state"
    key            = "thinkwork/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "thinkwork-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region
}

# Cloudflare provider reads its token from the CLOUDFLARE_API_TOKEN env var.
# Never commit the token to tfvars or source control.
provider "cloudflare" {}

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

variable "enable_hindsight" {
  description = "Optional Hindsight add-on alongside the always-on managed memory (ECS+ALB for semantic + graph retrieval)"
  type        = bool
  default     = false
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

variable "www_domain" {
  description = "Public website apex domain (e.g. thinkwork.ai). Leave empty to skip the custom domain and DNS wiring."
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for var.www_domain. Non-secret. Required when www_domain is set."
  type        = string
  default     = ""
}

locals {
  www_dns_enabled = var.www_domain != "" && var.cloudflare_zone_id != ""
  docs_domain     = var.www_domain != "" ? "docs.${var.www_domain}" : ""
}

module "thinkwork" {
  source = "../../modules/thinkwork"

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  db_password                = var.db_password
  database_engine            = var.database_engine
  enable_hindsight           = var.enable_hindsight
  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  pre_signup_lambda_zip      = var.pre_signup_lambda_zip
  lambda_zips_dir            = var.lambda_zips_dir
  api_auth_secret            = var.api_auth_secret

  # Public website custom domain (optional — wired only when www_domain is set)
  www_domain          = var.www_domain
  www_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Docs site custom domain (derived from www_domain — docs.<apex>). The
  # same ACM cert covers apex + www + docs so both distributions share it.
  docs_domain          = local.www_dns_enabled ? local.docs_domain : ""
  docs_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Greenfield: create everything (all defaults are true)
}

################################################################################
# Public Website DNS (Cloudflare zone, ACM cert, www→apex redirect, docs)
################################################################################

module "www_dns" {
  count  = local.www_dns_enabled ? 1 : 0
  source = "../../modules/app/www-dns"

  stage                       = var.stage
  domain                      = var.www_domain
  cloudflare_zone_id          = var.cloudflare_zone_id
  cloudfront_domain_name      = module.thinkwork.www_distribution_domain
  docs_cloudfront_domain_name = module.thinkwork.docs_distribution_domain
}

################################################################################
# Outputs
################################################################################

output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.thinkwork.api_endpoint
}

output "appsync_api_url" {
  description = "AppSync GraphQL URL"
  value       = module.thinkwork.appsync_api_url
}

output "appsync_realtime_url" {
  description = "AppSync realtime WebSocket URL (for frontend subscription clients)"
  value       = module.thinkwork.appsync_realtime_url
}

output "appsync_api_key" {
  description = "AppSync API key"
  value       = module.thinkwork.appsync_api_key
  sensitive   = true
}

output "auth_domain" {
  description = "Cognito hosted UI domain"
  value       = module.thinkwork.auth_domain
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

output "hindsight_enabled" {
  description = "Whether the Hindsight add-on is enabled"
  value       = module.thinkwork.hindsight_enabled
}

output "hindsight_endpoint" {
  description = "Hindsight API endpoint (null when enable_hindsight = false)"
  value       = module.thinkwork.hindsight_endpoint
}

output "agentcore_memory_id" {
  description = "AgentCore Memory resource ID used for automatic retention"
  value       = module.thinkwork.agentcore_memory_id
}

output "admin_url" {
  description = "Admin app URL"
  value       = "https://${module.thinkwork.admin_distribution_domain}"
}

output "admin_distribution_id" {
  description = "CloudFront distribution ID for admin (for cache invalidation)"
  value       = module.thinkwork.admin_distribution_id
}

output "admin_bucket_name" {
  description = "S3 bucket for admin app assets"
  value       = module.thinkwork.admin_bucket_name
}

output "docs_url" {
  description = "Docs site URL"
  value       = local.www_dns_enabled ? "https://${local.docs_domain}" : "https://${module.thinkwork.docs_distribution_domain}"
}

output "docs_distribution_id" {
  description = "CloudFront distribution ID for docs (for cache invalidation)"
  value       = module.thinkwork.docs_distribution_id
}

output "docs_bucket_name" {
  description = "S3 bucket for docs site assets"
  value       = module.thinkwork.docs_bucket_name
}

output "www_url" {
  description = "Public website URL"
  value       = var.www_domain != "" ? "https://${var.www_domain}" : "https://${module.thinkwork.www_distribution_domain}"
}

output "www_distribution_id" {
  description = "CloudFront distribution ID for the public website (for cache invalidation)"
  value       = module.thinkwork.www_distribution_id
}

output "www_distribution_domain" {
  description = "CloudFront distribution domain for the public website"
  value       = module.thinkwork.www_distribution_domain
}

output "www_bucket_name" {
  description = "S3 bucket for public website assets"
  value       = module.thinkwork.www_bucket_name
}
