# thinkwork-managed: enterprise-deploy-template

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

  backend "s3" {}
}

provider "aws" {
  region = var.region
}

provider "cloudflare" {}

variable "stage" {
  description = "Deployment stage. Must match the selected Terraform workspace."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "account_id" {
  description = "Customer AWS account ID."
  type        = string
}

variable "db_password" {
  description = "Aurora master password. Set through the GitHub Environment secret TF_VAR_DB_PASSWORD."
  type        = string
  sensitive   = true
}

variable "api_auth_secret" {
  description = "Shared service API secret. Set through the GitHub Environment secret TF_VAR_API_AUTH_SECRET."
  type        = string
  sensitive   = true
}

variable "database_engine" {
  description = "Database engine for this stage."
  type        = string
  default     = "aurora-serverless"
}

variable "lambda_artifact_bucket" {
  description = "Customer-owned S3 bucket containing pinned ThinkWork Lambda release artifacts."
  type        = string
}

variable "lambda_artifact_prefix" {
  description = "S3 prefix for the pinned ThinkWork Lambda release artifacts."
  type        = string
}

module "thinkwork" {
  source  = "thinkwork-ai/thinkwork/aws"
  version = "{{TERRAFORM_MODULE_VERSION}}"

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  database_engine = var.database_engine
  db_password     = var.db_password
  api_auth_secret = var.api_auth_secret

  lambda_artifact_bucket   = var.lambda_artifact_bucket
  lambda_artifact_prefix   = var.lambda_artifact_prefix
  require_lambda_artifacts = true
}

output "api_endpoint" {
  value = module.thinkwork.api_endpoint
}

output "lambda_artifact_mode" {
  value = module.thinkwork.lambda_artifact_mode
}

