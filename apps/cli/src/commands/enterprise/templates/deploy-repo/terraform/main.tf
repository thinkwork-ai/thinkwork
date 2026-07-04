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

variable "enable_hindsight" {
  description = "Enable Hindsight canonical user and Space memory. Full ThinkWork installs default this on; set false only for explicit low-cost/development AgentCore-only deployments."
  type        = bool
  default     = true
}

variable "memory_engine" {
  description = "Active long-term memory engine. Empty selects Hindsight when enable_hindsight = true. Use 'agentcore' only for explicit low-cost/development managed-memory deployments."
  type        = string
  default     = ""
}

variable "twenty_provisioned" {
  description = "Provision the retained Twenty CRM managed-app substrate. Runtime can be parked independently with twenty_runtime_enabled."
  type        = bool
  default     = false
}

variable "twenty_runtime_enabled" {
  description = "Run Twenty CRM server/worker tasks when the retained substrate is provisioned."
  type        = bool
  default     = false
}

variable "twenty_image_uri" {
  description = "Twenty CRM container image URI pinned to an immutable sha256 digest. Required when twenty_provisioned = true."
  type        = string
  default     = ""
}

variable "twenty_db_username" {
  description = "Dedicated PostgreSQL username for Twenty CRM."
  type        = string
  default     = "thinkwork_twenty"
}

variable "twenty_db_name" {
  description = "Dedicated PostgreSQL database name for Twenty CRM."
  type        = string
  default     = "thinkwork_twenty"
}

variable "twenty_db_url_secret_arn" {
  description = "Secrets Manager ARN containing a JSON PG_DATABASE_URL field for the dedicated Twenty database. Required when twenty_provisioned = true."
  type        = string
  default     = ""
}

variable "twenty_encryption_key_secret_arn" {
  description = "Secrets Manager ARN containing a JSON ENCRYPTION_KEY field for Twenty. Required when twenty_provisioned = true."
  type        = string
  default     = ""
}

variable "twenty_email_from_address" {
  description = "Verified SES sender address for Twenty app emails. Leave empty to derive noreply@ses_inbound_domain."
  type        = string
  default     = ""
}

variable "twenty_email_from_name" {
  description = "Display name for Twenty app email From headers."
  type        = string
  default     = "ThinkWork CRM"
}

variable "twenty_public_url" {
  description = "Public HTTPS URL for Twenty CRM. Leave empty to derive https://crm.<www_domain>."
  type        = string
  default     = ""
}

variable "twenty_certificate_arn" {
  description = "ACM certificate ARN for the Twenty public ALB. Leave empty to reuse the www-dns certificate."
  type        = string
  default     = ""
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

  enable_hindsight                           = var.enable_hindsight
  memory_engine                              = var.memory_engine
  twenty_provisioned                         = var.twenty_provisioned
  twenty_runtime_enabled                     = var.twenty_runtime_enabled
  twenty_image_uri                           = var.twenty_image_uri
  twenty_db_username                         = var.twenty_db_username
  twenty_db_name                             = var.twenty_db_name
  twenty_db_url_secret_arn                   = var.twenty_db_url_secret_arn
  twenty_encryption_key_secret_arn           = var.twenty_encryption_key_secret_arn
  twenty_email_from_address                  = var.twenty_email_from_address
  twenty_email_from_name                     = var.twenty_email_from_name
  twenty_public_url                          = var.twenty_public_url
  twenty_certificate_arn                     = var.twenty_certificate_arn

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

output "twenty_provisioned" {
  value = module.thinkwork.twenty_provisioned
}

output "twenty_runtime_enabled" {
  value = module.thinkwork.twenty_runtime_enabled
}

output "twenty_url" {
  value = module.thinkwork.twenty_url
}
