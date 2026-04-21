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

variable "ses_inbound_domain" {
  description = "Subdomain for agent email (e.g. agents.thinkwork.ai). Terraform creates a delegated Route53 hosted zone, SES domain identity + DKIM, MX record, and receipt rule. Leave empty to skip SES inbound resources."
  type        = string
  default     = ""
}

variable "lastmile_tasks_api_url" {
  description = <<-EOT
    OPTIONAL fallback base URL for the LastMile Tasks REST API.

    Prefer setting the URL per-tenant via the admin Connectors → LastMile
    page (stored in webhooks.config.baseUrl); that value takes precedence.
    This variable only fires when the per-tenant config is empty, and is
    mainly useful for single-tenant dev stacks and bootstrap scenarios.

    Leave blank (default) unless you specifically need the env-var
    fallback. Example: https://api-dev.lastmile-tei.com.
  EOT
  type        = string
  default     = ""
}

variable "wiki_compile_model_id" {
  description = <<-EOT
    Bedrock model id the wiki-compile Lambda uses for the leaf planner,
    aggregation planner, and section writer. Any Converse-compatible
    model works; change without a code deploy.

    Default: openai.gpt-oss-120b-1:0 (strong output quality at a lower
    per-minute throttle risk than Claude Haiku 4.5 on shared dev
    accounts). Swap to us.anthropic.claude-haiku-4-5-20251001-v1:0 for
    Claude, or amazon.nova-micro-v1:0 for a low-cost spike.
  EOT
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "wiki_aggregation_pass_enabled" {
  description = <<-EOT
    Feature flag for the wiki aggregation pass — the second LLM call
    per compile job that builds parent/hub rollup sections and promotes
    dense sections into their own topic pages.

    Accepts a string so the Lambda reads the env var verbatim; must be
    "true" / "1" / "yes" to enable. Set to "false" to stop the pipeline
    after the leaf pass (no rollups, no promotions).
  EOT
  type        = string
  default     = "true"
}

variable "google_places_api_key" {
  description = <<-EOT
    Google Places API (New) key used by wiki-compile to enrich POI records
    with city/state/country hierarchy during compile. When empty, compile
    gracefully degrades to metadata-only place rows (no hierarchy, no
    backing pages), so this is opt-in. Stored as a SecureString at
    /thinkwork/<stage>/google-places/api-key — see
    terraform/modules/app/lambda-api/handlers.tf for the SSM resource.

    The parameter's value has lifecycle.ignore_changes set, so you can
    rotate via `aws ssm put-parameter --overwrite` without terraform
    fighting you on the next apply.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "wiki_deterministic_linking_enabled" {
  description = <<-EOT
    Feature flag for deterministic compile-time link emission:
      - city/journal parent references from parent-expander candidates
      - entity↔entity co-mention edges via wiki_section_sources

    Accepts a string so the Lambda reads the env var verbatim; must be
    "true" / "1" / "yes" to enable. Rollback is a targeted DELETE:
    `DELETE FROM wiki_page_links WHERE context LIKE 'deterministic:%' OR
    context LIKE 'co_mention:%'` — provenance is preserved on every row.
  EOT
  type        = string
  default     = "true"
}

locals {
  www_dns_enabled = var.www_domain != "" && var.cloudflare_zone_id != ""
  docs_domain     = var.www_domain != "" ? "docs.${var.www_domain}" : ""
  admin_domain    = var.www_domain != "" ? "admin.${var.www_domain}" : ""
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
  # same ACM cert covers apex + www + docs + admin so every distribution
  # shares it.
  docs_domain          = local.www_dns_enabled ? local.docs_domain : ""
  docs_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Admin SPA custom domain (derived from www_domain — admin.<apex>).
  admin_domain          = local.www_dns_enabled ? local.admin_domain : ""
  admin_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # SES inbound email subdomain (delegated Route53 subzone).
  ses_inbound_domain = var.ses_inbound_domain

  # LastMile Tasks REST API base URL — feature-flags the outbound task
  # sync. Empty string keeps mobile-created tasks in sync_status='local'.
  lastmile_tasks_api_url = var.lastmile_tasks_api_url

  # Wiki compile Lambda config. Pinned so unrelated terraform applies
  # don't wipe the Bedrock model or the aggregation flag back to
  # whatever the Lambda env defaults to.
  wiki_compile_model_id              = var.wiki_compile_model_id
  wiki_aggregation_pass_enabled      = var.wiki_aggregation_pass_enabled
  wiki_deterministic_linking_enabled = var.wiki_deterministic_linking_enabled
  google_places_api_key              = var.google_places_api_key

  # Greenfield: create everything (all defaults are true)
}

################################################################################
# Public Website DNS (Cloudflare zone, ACM cert, www→apex redirect, docs)
################################################################################

module "www_dns" {
  count  = local.www_dns_enabled ? 1 : 0
  source = "../../modules/app/www-dns"

  stage                  = var.stage
  domain                 = var.www_domain
  cloudflare_zone_id     = var.cloudflare_zone_id
  cloudfront_domain_name = module.thinkwork.www_distribution_domain

  # Docs: include_docs is a plain bool (no output reference) so the
  # ACM cert SAN list doesn't depend on the docs distribution output,
  # which itself depends on the cert. docs_cloudfront_domain_name is
  # read only after the cert is created, for the CNAME record.
  include_docs                = true
  docs_cloudfront_domain_name = module.thinkwork.docs_distribution_domain

  # Admin: same cycle-avoidance pattern.
  include_admin                = true
  admin_cloudfront_domain_name = module.thinkwork.admin_distribution_domain
}

################################################################################
# SES Inbound DNS Delegation
#
# The ses-email module creates a Route53 hosted zone for var.ses_inbound_domain
# (e.g. agents.thinkwork.ai). For the subzone to resolve, the parent zone
# (thinkwork.ai at Cloudflare) must carry NS records pointing at the 4 AWS name
# servers. New Route53 zones always return exactly 4 name servers, so we can
# hardcode count = 4 without hitting "count value is not known" at plan time.
#
# Without this delegation, terraform creates the Route53 zone and the MX/DKIM
# records inside it, but the outside world asks Cloudflare for agents.thinkwork.ai
# and gets NXDOMAIN because Cloudflare doesn't know to delegate.
################################################################################

resource "cloudflare_record" "agents_ns" {
  count = var.ses_inbound_domain != "" && var.cloudflare_zone_id != "" ? 4 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.ses_inbound_domain
  content = module.thinkwork.ses_inbound_name_servers[count.index]
  type    = "NS"
  ttl     = 300
  proxied = false
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
  value       = local.www_dns_enabled ? "https://${local.admin_domain}" : "https://${module.thinkwork.admin_distribution_domain}"
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

output "ses_inbound_zone_id" {
  description = "Route53 hosted zone ID for the email subdomain (null when ses_inbound_domain is not set)"
  value       = module.thinkwork.ses_inbound_zone_id
}

output "ses_inbound_name_servers" {
  description = "Name servers for the delegated email subzone. Paste these as NS records at the registrar that hosts the parent domain (Google Domains for thinkwork.ai) before SES can verify."
  value       = module.thinkwork.ses_inbound_name_servers
}

output "ses_inbound_mx_target" {
  description = "MX target host for the email subdomain. Already written into the subzone by Terraform — informational."
  value       = module.thinkwork.ses_inbound_mx_target
}
