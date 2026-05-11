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

variable "enable_workspace_orchestration" {
  description = "Enable S3 EventBridge/SQS routing and the workspace event dispatcher for folder-native workspace orchestration."
  type        = bool
  default     = false
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

variable "stripe_price_ids_json" {
  description = "JSON object mapping internal plan names to Stripe price IDs for this stage, e.g. {\"starter\":\"price_...\",\"team\":\"price_...\"}. Non-secret; per-stage. Exposed to Lambdas as STRIPE_PRICE_IDS_JSON env var. The secret keys themselves live in AWS Secrets Manager at thinkwork/<stage>/stripe/api-credentials — never in tfvars."
  type        = string
  default     = "{}"
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

variable "company_brain_source_agent_model_id" {
  description = <<-EOT
    Bedrock model id the GraphQL Company Brain source-agent runtime uses
    for JSON tool/action turns. Defaults to Claude Haiku 4.5 for reliable
    action JSON while wiki compile can stay on gpt-oss for throughput.
  EOT
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
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

variable "mapbox_public_token" {
  description = <<-EOT
    Mapbox public pk.* token consumed by apps/computer's MapView primitive
    (in @thinkwork/computer-stdlib) for inline map tile rendering inside
    generated applets. Flows through to scripts/build-computer.sh →
    apps/computer/.env.production as VITE_MAPBOX_PUBLIC_TOKEN.

    Mapbox tokens are designed to ship in public bundles; URL allowlist
    on the Mapbox dashboard is the security boundary. Restrict the token
    to the deployed `computer.<apex>` host (and any dev hosts).

    Empty string is acceptable: MapView falls back to OpenStreetMap tiles
    when the build-time env var is unset, so dev environments without an
    operator-provisioned token still render maps.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "nova_act_api_key" {
  description = <<-EOT
    Nova Act API key used by the Strands Browser Automation tool. When empty,
    Terraform creates /thinkwork/<stage>/agentcore/nova-act-api-key with a
    placeholder value; populate or rotate the real key with:
      aws ssm put-parameter --overwrite --name /thinkwork/<stage>/agentcore/nova-act-api-key --type SecureString --value <KEY>

    The parameter's value has lifecycle.ignore_changes set, so operator
    rotation sticks across applies.
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

variable "agentcore_code_interpreter_id" {
  description = "AgentCore Code Interpreter id used by routine-task-python for SFN python recipe states."
  type        = string
  default     = ""
}

variable "mcp_custom_domain" {
  description = <<-EOT
    MCP custom domain (e.g. "mcp.thinkwork.ai"). Empty disables the
    custom-domain setup — the MCP endpoint stays reachable at the API
    Gateway execute-api URL. When set, an ACM cert is created on the
    first apply; flip `mcp_custom_domain_ready = true` on a second
    apply after DNS validation completes. See
    docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md.
  EOT
  type        = string
  default     = ""
}

variable "mcp_custom_domain_ready" {
  description = <<-EOT
    Second-apply gate for the MCP custom domain. Stays false on the
    first apply (cert creation + DNS validation). Flip to true after
    ACM shows the cert as ISSUED so the second apply can create the
    API Gateway custom domain + mapping. Ignored when
    mcp_custom_domain is empty.
  EOT
  type        = bool
  default     = false
}

locals {
  www_dns_enabled = var.www_domain != "" && var.cloudflare_zone_id != ""
  docs_domain     = var.www_domain != "" ? "docs.${var.www_domain}" : ""
  admin_domain    = var.www_domain != "" ? "admin.${var.www_domain}" : ""
  computer_domain = var.www_domain != "" ? "computer.${var.www_domain}" : ""
  sandbox_domain  = var.www_domain != "" ? "sandbox.${var.www_domain}" : ""
  api_domain      = var.www_domain != "" ? "api.${var.www_domain}" : ""
}

module "thinkwork" {
  source = "../../modules/thinkwork"

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  db_password                    = var.db_password
  database_engine                = var.database_engine
  enable_hindsight               = var.enable_hindsight
  google_oauth_client_id         = var.google_oauth_client_id
  google_oauth_client_secret     = var.google_oauth_client_secret
  pre_signup_lambda_zip          = var.pre_signup_lambda_zip
  lambda_zips_dir                = var.lambda_zips_dir
  enable_workspace_orchestration = var.enable_workspace_orchestration
  api_auth_secret                = var.api_auth_secret

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

  # Computer SPA custom domain (derived from www_domain — computer.<apex>).
  # Same ACM cert covers it via the include_computer SAN gate on www_dns.
  computer_domain          = local.www_dns_enabled ? local.computer_domain : ""
  computer_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Computer iframe sandbox (derived from www_domain — sandbox.<apex>).
  # Same ACM cert covers it via the include_computer_sandbox SAN gate.
  computer_sandbox_domain                 = local.www_dns_enabled ? local.sandbox_domain : ""
  computer_sandbox_certificate_arn        = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""
  computer_sandbox_allowed_parent_origins = local.www_dns_enabled ? "https://${local.computer_domain}" : ""

  # SES inbound email subdomain (delegated Route53 subzone).
  ses_inbound_domain = var.ses_inbound_domain

  # Wiki compile Lambda config. Pinned so unrelated terraform applies
  # don't wipe the Bedrock model or the aggregation flag back to
  # whatever the Lambda env defaults to.
  wiki_compile_model_id               = var.wiki_compile_model_id
  company_brain_source_agent_model_id = var.company_brain_source_agent_model_id
  wiki_aggregation_pass_enabled       = var.wiki_aggregation_pass_enabled
  wiki_deterministic_linking_enabled  = var.wiki_deterministic_linking_enabled
  google_places_api_key               = var.google_places_api_key
  nova_act_api_key                    = var.nova_act_api_key
  agentcore_code_interpreter_id       = var.agentcore_code_interpreter_id

  # Mapbox public token for apps/computer MapView primitive. Flows through
  # to scripts/build-computer.sh → VITE_MAPBOX_PUBLIC_TOKEN.
  mapbox_public_token = var.mapbox_public_token

  # Stripe billing — internal-plan → price-id map (per-stage, non-secret).
  stripe_price_ids_json = var.stripe_price_ids_json

  # MCP custom domain (e.g. mcp.thinkwork.ai). Two-apply flow: the first
  # apply creates the ACM cert (mcp_custom_domain_ready=false), the
  # second apply attaches the domain + API mapping after DNS validation
  # (mcp_custom_domain_ready=true). Runbook:
  # docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md
  mcp_custom_domain       = var.mcp_custom_domain
  mcp_custom_domain_ready = var.mcp_custom_domain_ready

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

  # Computer: same cycle-avoidance pattern as docs/admin. Phase one of the
  # two-phase first apply (#971) used a static empty string here to dodge an
  # "Invalid count argument" plan error while module.thinkwork.computer_site
  # didn't yet exist in state. Now that the distribution is created and its
  # domain is known, this can read the real output — `!= ""` resolves to a
  # static true and the Cloudflare CNAME for computer.<domain> gets created
  # on this apply.
  include_computer                = true
  computer_cloudfront_domain_name = module.thinkwork.computer_distribution_domain

  # Computer iframe sandbox: same cycle-avoidance pattern as computer.
  include_computer_sandbox                = true
  computer_sandbox_cloudfront_domain_name = module.thinkwork.computer_sandbox_distribution_domain

  # API custom domain (api.<apex>). Same cycle-avoidance — the ACM cert SAN
  # list is gated on include_api (a plain bool), while api_gateway_id (which
  # the cert doesn't depend on) is read at record-creation time.
  include_api            = true
  api_gateway_id         = module.thinkwork.api_id
  api_gateway_stage_name = "$default"
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

output "api_domain" {
  description = "Custom domain for the HTTP API (e.g. api.thinkwork.ai). Empty string when www_domain/cloudflare_zone_id aren't configured. Read by scripts/build-www.sh to set PUBLIC_API_URL at build time."
  value       = local.www_dns_enabled ? local.api_domain : ""
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

output "mapbox_public_token" {
  description = "Mapbox public token used by apps/computer MapView. Read by scripts/build-computer.sh to inline VITE_MAPBOX_PUBLIC_TOKEN at build time; empty string lets MapView fall back to OpenStreetMap tiles."
  value       = module.thinkwork.mapbox_public_token
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

output "computer_url" {
  description = "Computer app URL"
  value       = local.www_dns_enabled ? "https://${local.computer_domain}" : "https://${module.thinkwork.computer_distribution_domain}"
}

output "computer_distribution_id" {
  description = "CloudFront distribution ID for computer (for cache invalidation)"
  value       = module.thinkwork.computer_distribution_id
}

output "computer_bucket_name" {
  description = "S3 bucket for computer app assets"
  value       = module.thinkwork.computer_bucket_name
}

output "computer_sandbox_distribution_id" {
  description = "CloudFront distribution ID for the Computer iframe sandbox (for cache invalidation)"
  value       = module.thinkwork.computer_sandbox_distribution_id
}

output "computer_sandbox_bucket_name" {
  description = "S3 bucket for the Computer iframe sandbox shell assets"
  value       = module.thinkwork.computer_sandbox_bucket_name
}

output "computer_sandbox_url" {
  description = "Computer iframe sandbox URL"
  value       = module.thinkwork.computer_sandbox_url
}

output "computer_sandbox_allowed_parent_origins" {
  description = "Trusted parent origins for the Computer iframe sandbox"
  value       = module.thinkwork.computer_sandbox_allowed_parent_origins
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

# MCP custom domain — consumed by `pnpm cf:sync-mcp`.
output "mcp_custom_domain" {
  description = "Configured MCP custom domain (e.g., mcp.thinkwork.ai), or empty when disabled."
  value       = module.thinkwork.mcp_custom_domain
}

output "mcp_custom_domain_cert_arn" {
  description = "ACM cert ARN for the MCP custom domain. Pass to `pnpm cf:sync-mcp --cert-arn` in direct-args mode."
  value       = module.thinkwork.mcp_custom_domain_cert_arn
}

output "mcp_custom_domain_validation" {
  description = "DNS validation records to add to Cloudflare for ACM to issue the cert. Each record: { name, type, value }."
  value       = module.thinkwork.mcp_custom_domain_validation
}

output "mcp_custom_domain_target" {
  description = "Regional target for the final mcp CNAME — only populated on the second apply after mcp_custom_domain_ready=true. { target_domain_name, hosted_zone_id } or null."
  value       = module.thinkwork.mcp_custom_domain_target
}
