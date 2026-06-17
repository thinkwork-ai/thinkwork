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

# us-east-1 alias required by the thinkwork module's customer-domain wiring
# (CloudFront ACM certs must live in us-east-1 regardless of stack region).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
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

variable "plugin_catalog_github_token_secret_arn" {
  description = "Optional Secrets Manager ARN/name containing a GitHub token for API plugin catalog release-asset fetches. Empty uses unauthenticated GitHub requests."
  type        = string
  default     = ""
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

variable "enable_cognee" {
  description = "Enable Cognee as an optional ontology/knowledge-graph add-on. Disabled by default."
  type        = bool
  default     = false
}

variable "cognee_image_uri" {
  description = "Cognee container image URI pinned to an immutable sha256 digest. Required when enable_cognee = true."
  type        = string
  default     = ""
}

variable "cognee_db_username" {
  description = "Dedicated PostgreSQL username for Cognee metadata storage."
  type        = string
  default     = "thinkwork_cognee"
}

variable "cognee_db_name" {
  description = "Dedicated PostgreSQL database name for Cognee metadata storage."
  type        = string
  default     = "thinkwork_cognee"
}

variable "cognee_db_password_secret_arn" {
  description = "Secrets Manager ARN containing a JSON password field for the dedicated Cognee PostgreSQL user. Required when enable_cognee = true."
  type        = string
  default     = ""
}

variable "cognee_allowed_internal_cidr_blocks" {
  description = "CIDR blocks allowed to reach the internal Cognee ALB."
  type        = list(string)
  default     = []
}

variable "cognee_allowed_internal_security_group_ids" {
  description = "Security group IDs allowed to reach the internal Cognee ALB."
  type        = list(string)
  default     = []
}

variable "cognee_backend_mode" {
  description = "Cognee backend mode. dogfood uses EFS-backed local stores; remote requires graph/vector URLs."
  type        = string
  default     = "dogfood"
}

variable "cognee_desired_count" {
  description = "Desired Cognee task count. Dogfood mode must stay at 1."
  type        = number
  default     = 1
}

variable "cognee_brain_tenant_id" {
  description = "Tenant ID for a tenant-scoped Company Brain substrate instance. Empty preserves legacy stage-wide Cognee names."
  type        = string
  default     = ""
}

variable "cognee_brain_instance_key" {
  description = "Stable tenant-scoped Brain instance key used to derive resource names."
  type        = string
  default     = ""
}

variable "cognee_brain_storage_tier" {
  description = "Company Brain storage tier: default or production."
  type        = string
  default     = "default"
}

variable "cognee_brain_s3_artifact_root" {
  description = "Canonical Company Brain S3 root URI for source artifacts."
  type        = string
  default     = ""
}

variable "cognee_brain_s3_manifest_root" {
  description = "Canonical Company Brain S3 root URI for ingestion manifests."
  type        = string
  default     = ""
}

variable "cognee_brain_s3_vault_projection_root" {
  description = "Canonical Company Brain S3 root URI for vault/materialized projections."
  type        = string
  default     = ""
}

variable "cognee_brain_artifacts_bucket_arn" {
  description = "Optional canonical Company Brain artifacts bucket ARN for scoped task-role access."
  type        = string
  default     = ""
}

variable "cognee_brain_artifacts_prefixes" {
  description = "Tenant/stage prefixes inside cognee_brain_artifacts_bucket_arn the Brain task may access."
  type        = list(string)
  default     = []
}

variable "cognee_private_substrate_mode" {
  description = "Whether the Company Brain substrate is private/internal-only."
  type        = bool
  default     = true
}

variable "cognee_require_authentication" {
  description = "Passed to Cognee REQUIRE_AUTHENTICATION."
  type        = bool
  default     = false
}

variable "cognee_enable_backend_access_control" {
  description = "Passed to Cognee ENABLE_BACKEND_ACCESS_CONTROL."
  type        = bool
  default     = false
}

variable "cognee_cors_allowed_origins" {
  description = "Passed to Cognee CORS_ALLOWED_ORIGINS."
  type        = string
  default     = ""
}

variable "cognee_llm_provider" {
  description = "Cognee LLM provider."
  type        = string
  default     = "bedrock"
}

variable "cognee_llm_model" {
  description = "Cognee LLM model. Must handle tool-use structured extraction reliably — nova-lite repeatedly produced invalid ToolUse sequences on observation documents, and Haiku is rate-limited on this account. Kimi K2.5 is ON_DEMAND (no inference profile needed)."
  type        = string
  default     = "bedrock/moonshotai.kimi-k2.5"
}

variable "cognee_llm_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock Cognee LLM provider API key."
  type        = string
  default     = ""
}

variable "cognee_embedding_provider" {
  description = "Cognee embedding provider."
  type        = string
  default     = "bedrock"
}

variable "cognee_embedding_model" {
  description = "Cognee embedding model."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "cognee_embedding_dimensions" {
  description = "Cognee embedding dimensions."
  type        = number
  default     = 1024
}

variable "cognee_embedding_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock Cognee embedding provider API key."
  type        = string
  default     = ""
}

variable "cognee_vector_db_provider" {
  description = "Cognee vector store provider."
  type        = string
  default     = "lancedb"
}

variable "cognee_vector_db_url" {
  description = "Cognee vector store URL. Empty uses the dogfood local default."
  type        = string
  default     = ""
}

variable "cognee_vector_db_key_secret_arn" {
  description = "Optional Secrets Manager ARN for remote Cognee vector store credentials."
  type        = string
  default     = ""
}

variable "cognee_graph_database_provider" {
  description = "Cognee graph store provider."
  type        = string
  default     = "kuzu"
}

variable "cognee_graph_database_url" {
  description = "Cognee graph store URL. Empty uses the dogfood local default."
  type        = string
  default     = ""
}

variable "cognee_graph_database_username" {
  description = "Optional Cognee graph store username."
  type        = string
  default     = ""
}

variable "cognee_graph_database_password_secret_arn" {
  description = "Optional Secrets Manager ARN for remote Cognee graph store password."
  type        = string
  default     = ""
}

variable "cognee_neptune_graph_id" {
  description = "Neptune Analytics graph ID used by the production Brain tier."
  type        = string
  default     = ""
}

variable "cognee_neptune_graph_arn" {
  description = "Optional Neptune Analytics graph ARN for scoped task-role access."
  type        = string
  default     = ""
}

variable "cognee_neptune_endpoint" {
  description = "Neptune Analytics endpoint used by the production Brain tier."
  type        = string
  default     = ""
}

variable "cognee_production_posture" {
  description = "Operator evidence string for production-tier approval/readiness posture."
  type        = string
  default     = ""
}

variable "cognee_bedrock_model_resource_arns" {
  description = "Explicit Bedrock model ARNs Cognee may invoke when a Bedrock provider is selected."
  type        = list(string)
  default     = []
}

variable "cognee_kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt Cognee-injected secrets."
  type        = list(string)
  default     = []
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
  description = "ACM certificate ARN for the Twenty public ALB. Leave empty to create a dedicated crm.<www_domain> certificate when Twenty is provisioned."
  type        = string
  default     = ""
}

variable "plane_provisioned" {
  description = "Provision the retained Plane managed-app substrate. Runtime can be parked independently with plane_runtime_enabled."
  type        = bool
  default     = false
}

variable "plane_runtime_enabled" {
  description = "Run Plane ECS services when the retained substrate is provisioned."
  type        = bool
  default     = false
}

variable "plane_image_uri" {
  description = "Plane container image URI pinned to an immutable sha256 digest. Required when plane_provisioned = true."
  type        = string
  default     = ""
}

variable "plane_db_url_secret_arn" {
  description = "Secrets Manager ARN containing a JSON DATABASE_URL field for the dedicated Plane database."
  type        = string
  default     = ""
}

variable "plane_db_username" {
  description = "Dedicated PostgreSQL username for Plane."
  type        = string
  default     = "thinkwork_plane"
}

variable "plane_db_name" {
  description = "Dedicated PostgreSQL database name for Plane."
  type        = string
  default     = "thinkwork_plane"
}

variable "plane_secret_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane SECRET_KEY."
  type        = string
  default     = ""
}

variable "plane_live_server_secret_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane LIVE_SERVER_SECRET_KEY."
  type        = string
  default     = ""
}

variable "plane_aes_secret_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane AES_SECRET_KEY."
  type        = string
  default     = ""
}

variable "plane_amqp_url_secret_arn" {
  description = "Deprecated no-op. Plane creates AMQP_URL from the managed Amazon MQ broker endpoint."
  type        = string
  default     = ""
}

variable "plane_s3_access_key_id_secret_arn" {
  description = "Secrets Manager ARN containing Plane AWS_ACCESS_KEY_ID for S3 uploads."
  type        = string
  default     = ""
}

variable "plane_s3_secret_access_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane AWS_SECRET_ACCESS_KEY for S3 uploads."
  type        = string
  default     = ""
}

variable "plane_s3_bucket_name" {
  description = "S3 bucket name used for Plane file uploads. Required when plane_provisioned = true."
  type        = string
  default     = ""
}

variable "plane_cache_engine" {
  description = "ElastiCache engine for Plane. Prefer valkey; redis is available as a compatibility fallback."
  type        = string
  default     = "valkey"
}

variable "plane_cache_engine_version" {
  description = "ElastiCache engine version for the selected Plane cache engine."
  type        = string
  default     = "8.0"
}

variable "plane_cache_parameter_group_family" {
  description = "ElastiCache parameter group family matching plane_cache_engine/plane_cache_engine_version."
  type        = string
  default     = "valkey8"
}

variable "plane_cache_node_type" {
  description = "ElastiCache node type for Plane."
  type        = string
  default     = "cache.t4g.micro"
}

variable "plane_cache_num_cache_clusters" {
  description = "Number of Plane cache nodes in the replication group."
  type        = number
  default     = 1
}

variable "plane_rabbitmq_engine_version" {
  description = "Amazon MQ RabbitMQ engine version for Plane."
  type        = string
  default     = "3.13"
}

variable "plane_rabbitmq_instance_type" {
  description = "Amazon MQ RabbitMQ broker instance type for Plane. mq.m7g.medium is the smallest current RabbitMQ option in us-east-1."
  type        = string
  default     = "mq.m7g.medium"
}

variable "plane_rabbitmq_deployment_mode" {
  description = "Amazon MQ RabbitMQ deployment mode for Plane."
  type        = string
  default     = "SINGLE_INSTANCE"
}

variable "plane_public_url" {
  description = "Public HTTPS URL for Plane. Leave empty to derive https://plane.<www_domain>."
  type        = string
  default     = ""
}

variable "plane_certificate_arn" {
  description = "ACM certificate ARN for the Plane public ALB. Leave empty to create a dedicated plane.<www_domain> certificate when Plane is provisioned."
  type        = string
  default     = ""
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

variable "lambda_artifact_bucket" {
  description = "S3 bucket containing Lambda release artifacts. Mutually exclusive with lambda_zips_dir."
  type        = string
  default     = ""
}

variable "lambda_artifact_prefix" {
  description = "S3 key prefix containing Lambda release artifacts, for example releases/v1.2.3/lambdas."
  type        = string
  default     = "latest/lambdas"
}

variable "require_lambda_artifacts" {
  description = "Fail planning unless either lambda_zips_dir or lambda_artifact_bucket/lambda_artifact_prefix is configured."
  type        = bool
  default     = false
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

variable "platform_operator_emails" {
  description = "Comma-separated email allowlist for operator-gated GraphQL mutations."
  type        = string
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

variable "ses_parent_domain" {
  description = "Parent domain for tenant-scoped Space email addresses (e.g. thinkwork.ai). Leave empty to skip SES inbound resources."
  type        = string
  default     = ""
}

variable "ses_inbound_domain" {
  description = "Legacy delegated subdomain for agent email (e.g. agents.thinkwork.ai). Keep configured until legacy-address retirement notices are no longer needed."
  type        = string
  default     = ""
}

variable "tenant_slugs" {
  description = "Tenant slugs to provision as SES receiving subdomains under ses_parent_domain. Each slug creates <slug>.<ses_parent_domain>."
  type        = set(string)
  default     = []
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

variable "requester_idle_memory_learning_enabled" {
  description = "Enable requester-scoped 15-minute idle memory learning."
  type        = bool
  default     = true
}

variable "requester_memory_dreaming_enabled" {
  description = "Enable recurring requester memory dreaming sweeps."
  type        = bool
  default     = true
}

variable "requester_memory_dreaming_schedule_expression" {
  description = "EventBridge Scheduler expression for requester memory dreaming sweeps."
  type        = string
  default     = "cron(30 4 * * ? *)"
}

variable "requester_memory_dreaming_model_id" {
  description = "Bedrock Converse model id for requester memory REM reflection."
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
    Mapbox public pk.* token consumed by the apps/web MapView primitive
    (in @thinkwork/computer-stdlib) for inline map tile rendering inside
    generated applets. Flows through to scripts/build-web.sh →
    apps/web/.env.production as VITE_MAPBOX_PUBLIC_TOKEN.

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

variable "agentcore_memory_id" {
  description = "Optional pre-existing AgentCore Memory resource ID. When set, skips memory auto-provisioning and reuses this ID."
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

variable "customer_domain" {
  description = "Customer domain for this deployment (e.g. tei.thinkwork.ai), claimed via the shared namespace claim tool. Leave empty to skip all customer-domain resources."
  type        = string
  default     = ""
}

variable "customer_domain_delegated" {
  description = "Set true once the apex zone's NS records point at the customer zone (claim tool phase two). Gates the ACM certificate, the web alias records, and the customer-domain Cognito callback entries. Requires customer_domain."
  type        = bool
  default     = false
}

variable "customer_domain_legacy_retired" {
  description = "Set true to remove the legacy (non-customer-domain) end-user app URLs from the Cognito callback/logout lists after the dual-domain cutover window closes. Requires customer_domain_delegated."
  type        = bool
  default     = false
}

locals {
  www_dns_enabled = var.www_domain != "" && var.cloudflare_zone_id != ""
  docs_domain     = var.www_domain != "" ? "docs.${var.www_domain}" : ""
  app_domain      = var.www_domain != "" ? "app.${var.www_domain}" : ""
  computer_domain = var.www_domain != "" ? "computer.${var.www_domain}" : ""
  sandbox_domain  = var.www_domain != "" ? "sandbox.${var.www_domain}" : ""
  api_domain      = var.www_domain != "" ? "api.${var.www_domain}" : ""
  crm_domain      = var.www_domain != "" ? "crm.${var.www_domain}" : ""
  plane_domain    = var.www_domain != "" ? "plane.${var.www_domain}" : ""
  twenty_url      = var.twenty_public_url != "" ? var.twenty_public_url : (local.crm_domain != "" ? "https://${local.crm_domain}" : "")
  plane_url       = var.plane_public_url != "" ? var.plane_public_url : (local.plane_domain != "" ? "https://${local.plane_domain}" : "")

  twenty_managed_certificate_enabled = local.www_dns_enabled && var.twenty_provisioned && var.twenty_certificate_arn == "" && local.crm_domain != ""
  plane_managed_certificate_enabled  = local.www_dns_enabled && var.plane_provisioned && var.plane_certificate_arn == "" && local.plane_domain != ""
}

resource "aws_acm_certificate" "computer_sandbox" {
  count = local.www_dns_enabled ? 1 : 0

  domain_name       = local.sandbox_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-computer-sandbox"
  }
}

resource "cloudflare_record" "computer_sandbox_acm_validation" {
  for_each = {
    for dvo in flatten([
      for cert in aws_acm_certificate.computer_sandbox : tolist(cert.domain_validation_options)
      ]) : dvo.domain_name => {
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
      type  = dvo.resource_record_type
    }
  }

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.name, ".")
  content = trimsuffix(each.value.value, ".")
  type    = each.value.type
  ttl     = 60
  proxied = false
  comment = "ACM DNS validation for ${each.key}"

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "computer_sandbox" {
  count = local.www_dns_enabled ? 1 : 0

  certificate_arn = aws_acm_certificate.computer_sandbox[0].arn
  validation_record_fqdns = [
    for record in cloudflare_record.computer_sandbox_acm_validation : record.hostname
  ]
}

resource "aws_acm_certificate" "twenty" {
  count = local.twenty_managed_certificate_enabled ? 1 : 0

  domain_name       = local.crm_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-twenty"
  }
}

resource "cloudflare_record" "twenty_acm_validation" {
  for_each = {
    for dvo in flatten([
      for cert in aws_acm_certificate.twenty : tolist(cert.domain_validation_options)
      ]) : dvo.domain_name => {
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
      type  = dvo.resource_record_type
    }
  }

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.name, ".")
  content = trimsuffix(each.value.value, ".")
  type    = each.value.type
  ttl     = 60
  proxied = false
  comment = "ACM DNS validation for ${each.key}"

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "twenty" {
  count = local.twenty_managed_certificate_enabled ? 1 : 0

  certificate_arn = aws_acm_certificate.twenty[0].arn
  validation_record_fqdns = [
    for record in cloudflare_record.twenty_acm_validation : record.hostname
  ]
}

resource "aws_acm_certificate" "plane" {
  count = local.plane_managed_certificate_enabled ? 1 : 0

  domain_name       = local.plane_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-plane"
  }
}

resource "cloudflare_record" "plane_acm_validation" {
  for_each = {
    for dvo in flatten([
      for cert in aws_acm_certificate.plane : tolist(cert.domain_validation_options)
      ]) : dvo.domain_name => {
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
      type  = dvo.resource_record_type
    }
  }

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.name, ".")
  content = trimsuffix(each.value.value, ".")
  type    = each.value.type
  ttl     = 60
  proxied = false
  comment = "ACM DNS validation for ${each.key}"

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "plane" {
  count = local.plane_managed_certificate_enabled ? 1 : 0

  certificate_arn = aws_acm_certificate.plane[0].arn
  validation_record_fqdns = [
    for record in cloudflare_record.plane_acm_validation : record.hostname
  ]
}

moved {
  from = module.www_dns[0].cloudflare_record.acm_validation["crm.thinkwork.ai"]
  to   = cloudflare_record.twenty_acm_validation["crm.thinkwork.ai"]
}

module "thinkwork" {
  source = "../../modules/thinkwork"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  plugin_catalog_github_token_secret_arn = var.plugin_catalog_github_token_secret_arn

  db_password                                = var.db_password
  database_engine                            = var.database_engine
  enable_hindsight                           = var.enable_hindsight
  enable_cognee                              = var.enable_cognee
  cognee_image_uri                           = var.cognee_image_uri
  cognee_db_username                         = var.cognee_db_username
  cognee_db_name                             = var.cognee_db_name
  cognee_db_password_secret_arn              = var.cognee_db_password_secret_arn
  cognee_allowed_internal_cidr_blocks        = var.cognee_allowed_internal_cidr_blocks
  cognee_allowed_internal_security_group_ids = var.cognee_allowed_internal_security_group_ids
  cognee_backend_mode                        = var.cognee_backend_mode
  cognee_desired_count                       = var.cognee_desired_count
  cognee_brain_tenant_id                     = var.cognee_brain_tenant_id
  cognee_brain_instance_key                  = var.cognee_brain_instance_key
  cognee_brain_storage_tier                  = var.cognee_brain_storage_tier
  cognee_brain_s3_artifact_root              = var.cognee_brain_s3_artifact_root
  cognee_brain_s3_manifest_root              = var.cognee_brain_s3_manifest_root
  cognee_brain_s3_vault_projection_root      = var.cognee_brain_s3_vault_projection_root
  cognee_brain_artifacts_bucket_arn          = var.cognee_brain_artifacts_bucket_arn
  cognee_brain_artifacts_prefixes            = var.cognee_brain_artifacts_prefixes
  cognee_private_substrate_mode              = var.cognee_private_substrate_mode
  cognee_require_authentication              = var.cognee_require_authentication
  cognee_enable_backend_access_control       = var.cognee_enable_backend_access_control
  cognee_cors_allowed_origins                = var.cognee_cors_allowed_origins
  cognee_llm_provider                        = var.cognee_llm_provider
  cognee_llm_model                           = var.cognee_llm_model
  cognee_llm_api_key_secret_arn              = var.cognee_llm_api_key_secret_arn
  cognee_embedding_provider                  = var.cognee_embedding_provider
  cognee_embedding_model                     = var.cognee_embedding_model
  cognee_embedding_dimensions                = var.cognee_embedding_dimensions
  cognee_embedding_api_key_secret_arn        = var.cognee_embedding_api_key_secret_arn
  cognee_vector_db_provider                  = var.cognee_vector_db_provider
  cognee_vector_db_url                       = var.cognee_vector_db_url
  cognee_vector_db_key_secret_arn            = var.cognee_vector_db_key_secret_arn
  cognee_graph_database_provider             = var.cognee_graph_database_provider
  cognee_graph_database_url                  = var.cognee_graph_database_url
  cognee_graph_database_username             = var.cognee_graph_database_username
  cognee_graph_database_password_secret_arn  = var.cognee_graph_database_password_secret_arn
  cognee_neptune_graph_id                    = var.cognee_neptune_graph_id
  cognee_neptune_graph_arn                   = var.cognee_neptune_graph_arn
  cognee_neptune_endpoint                    = var.cognee_neptune_endpoint
  cognee_production_posture                  = var.cognee_production_posture
  cognee_bedrock_model_resource_arns         = var.cognee_bedrock_model_resource_arns
  cognee_kms_key_arns                        = var.cognee_kms_key_arns
  twenty_provisioned                         = var.twenty_provisioned
  twenty_runtime_enabled                     = var.twenty_runtime_enabled
  twenty_image_uri                           = var.twenty_image_uri
  twenty_db_username                         = var.twenty_db_username
  twenty_db_name                             = var.twenty_db_name
  twenty_db_url_secret_arn                   = var.twenty_db_url_secret_arn
  twenty_encryption_key_secret_arn           = var.twenty_encryption_key_secret_arn
  twenty_email_from_address                  = var.twenty_email_from_address
  twenty_email_from_name                     = var.twenty_email_from_name
  twenty_public_url                          = local.twenty_url
  twenty_certificate_arn                     = var.twenty_certificate_arn != "" ? var.twenty_certificate_arn : (local.twenty_managed_certificate_enabled ? aws_acm_certificate_validation.twenty[0].certificate_arn : "")
  plane_provisioned                          = var.plane_provisioned
  plane_runtime_enabled                      = var.plane_runtime_enabled
  plane_image_uri                            = var.plane_image_uri
  plane_db_username                          = var.plane_db_username
  plane_db_name                              = var.plane_db_name
  plane_db_url_secret_arn                    = var.plane_db_url_secret_arn
  plane_secret_key_secret_arn                = var.plane_secret_key_secret_arn
  plane_live_server_secret_key_secret_arn    = var.plane_live_server_secret_key_secret_arn
  plane_aes_secret_key_secret_arn            = var.plane_aes_secret_key_secret_arn
  plane_amqp_url_secret_arn                  = var.plane_amqp_url_secret_arn
  plane_s3_access_key_id_secret_arn          = var.plane_s3_access_key_id_secret_arn
  plane_s3_secret_access_key_secret_arn      = var.plane_s3_secret_access_key_secret_arn
  plane_s3_bucket_name                       = var.plane_s3_bucket_name
  plane_cache_engine                         = var.plane_cache_engine
  plane_cache_engine_version                 = var.plane_cache_engine_version
  plane_cache_parameter_group_family         = var.plane_cache_parameter_group_family
  plane_cache_node_type                      = var.plane_cache_node_type
  plane_cache_num_cache_clusters             = var.plane_cache_num_cache_clusters
  plane_rabbitmq_engine_version              = var.plane_rabbitmq_engine_version
  plane_rabbitmq_instance_type               = var.plane_rabbitmq_instance_type
  plane_rabbitmq_deployment_mode             = var.plane_rabbitmq_deployment_mode
  plane_public_url                           = local.plane_url
  plane_certificate_arn                      = var.plane_certificate_arn != "" ? var.plane_certificate_arn : (local.plane_managed_certificate_enabled ? aws_acm_certificate_validation.plane[0].certificate_arn : "")
  google_oauth_client_id                     = var.google_oauth_client_id
  google_oauth_client_secret                 = var.google_oauth_client_secret
  pre_signup_lambda_zip                      = var.pre_signup_lambda_zip
  lambda_zips_dir                            = var.lambda_zips_dir
  lambda_artifact_bucket                     = var.lambda_artifact_bucket
  lambda_artifact_prefix                     = var.lambda_artifact_prefix
  require_lambda_artifacts                   = var.require_lambda_artifacts
  enable_workspace_orchestration             = var.enable_workspace_orchestration
  api_auth_secret                            = var.api_auth_secret
  platform_operator_emails                   = var.platform_operator_emails

  # Public website custom domain (optional — wired only when www_domain is set)
  www_domain          = var.www_domain
  www_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Docs site custom domain (derived from www_domain — docs.<apex>). The
  # same ACM cert covers apex + www + docs + app/computer so every distribution
  # shares it.
  docs_domain          = local.www_dns_enabled ? local.docs_domain : ""
  docs_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # End-user app custom domain (derived from www_domain — app.<apex>).
  # Same ACM cert covers it via the include_app SAN gate on www_dns.
  app_domain          = local.www_dns_enabled ? local.app_domain : ""
  app_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Deprecated compatibility host (derived from www_domain — computer.<apex>).
  # www-dns redirects this host to app.<apex> while old bookmarks/OAuth
  # callbacks are still in circulation.
  computer_domain          = local.www_dns_enabled ? local.computer_domain : ""
  computer_certificate_arn = local.www_dns_enabled ? module.www_dns[0].certificate_arn : ""

  # Computer iframe sandbox (derived from www_domain — sandbox.<apex>).
  # Uses its own ACM certificate so sandbox bootstrap/rotation cannot replace
  # the shared apex/www/docs/app/computer/api certificate.
  computer_sandbox_domain                 = local.www_dns_enabled ? local.sandbox_domain : ""
  computer_sandbox_certificate_arn        = local.www_dns_enabled ? aws_acm_certificate_validation.computer_sandbox[0].certificate_arn : ""
  computer_sandbox_allowed_parent_origins = local.www_dns_enabled ? "https://${local.app_domain}" : ""

  # SES inbound email subdomains (delegated Route53 subzones).
  ses_inbound_domain = var.ses_inbound_domain
  ses_parent_domain  = var.ses_parent_domain
  ses_tenant_slugs   = var.tenant_slugs

  # Wiki compile Lambda config. Pinned so unrelated terraform applies
  # don't wipe the Bedrock model or the aggregation flag back to
  # whatever the Lambda env defaults to.
  wiki_compile_model_id                         = var.wiki_compile_model_id
  company_brain_source_agent_model_id           = var.company_brain_source_agent_model_id
  wiki_aggregation_pass_enabled                 = var.wiki_aggregation_pass_enabled
  wiki_deterministic_linking_enabled            = var.wiki_deterministic_linking_enabled
  google_places_api_key                         = var.google_places_api_key
  requester_idle_memory_learning_enabled        = var.requester_idle_memory_learning_enabled
  requester_memory_dreaming_enabled             = var.requester_memory_dreaming_enabled
  requester_memory_dreaming_schedule_expression = var.requester_memory_dreaming_schedule_expression
  requester_memory_dreaming_model_id            = var.requester_memory_dreaming_model_id
  agentcore_code_interpreter_id                 = var.agentcore_code_interpreter_id
  agentcore_memory_id                           = var.agentcore_memory_id

  # Mapbox public token for apps/web MapView primitive. Flows through
  # to scripts/build-web.sh → VITE_MAPBOX_PUBLIC_TOKEN.
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

  # Customer-namespace domain (optional — two-apply flow; see README).
  customer_domain                = var.customer_domain
  customer_domain_delegated      = var.customer_domain_delegated
  customer_domain_legacy_retired = var.customer_domain_legacy_retired

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

  # End-user app: canonical app.<apex> host. The compatibility output names
  # still use computer_* while the source path is apps/web.
  include_app                = true
  app_cloudfront_domain_name = module.thinkwork.app_distribution_domain

  # Compatibility host: computer.<apex> redirects to app.<apex> while old
  # bookmarks and OAuth callbacks are still in circulation.
  include_computer = true

  # Computer iframe sandbox: same cycle-avoidance pattern as computer.
  include_computer_sandbox                = true
  computer_sandbox_cloudfront_domain_name = module.thinkwork.computer_sandbox_distribution_domain

  # API custom domain (api.<apex>). Same cycle-avoidance — the ACM cert SAN
  # list is gated on include_api (a plain bool), while api_gateway_id (which
  # the cert doesn't depend on) is read at record-creation time.
  include_api            = true
  api_gateway_id         = module.thinkwork.api_id
  api_gateway_stage_name = "$default"

  # Twenty CRM custom domain (crm.<apex>). CRM uses its own ACM certificate;
  # this module owns only the public CNAME to the ALB.
  include_crm      = var.twenty_provisioned
  crm_alb_dns_name = module.thinkwork.twenty_alb_dns_name != null ? module.thinkwork.twenty_alb_dns_name : ""

  # Plane custom domain (plane.<apex>). Plane uses its own ACM certificate;
  # this module owns only the public CNAME to the ALB.
  include_plane      = var.plane_provisioned
  plane_alb_dns_name = module.thinkwork.plane_alb_dns_name != null ? module.thinkwork.plane_alb_dns_name : ""
}

################################################################################
# SES Inbound DNS Delegation
#
# The ses-email module keeps the legacy Route53 hosted zone for
# var.ses_inbound_domain (e.g. agents.thinkwork.ai) and creates one Route53
# hosted zone for each tenant subdomain (e.g. dev.thinkwork.ai). For those
# subzones to resolve, the parent zone (thinkwork.ai at Cloudflare) must carry
# NS records pointing each subdomain at its 4 AWS name servers. New Route53
# zones always return exactly 4 name servers, so we can hardcode range(4)
# without hitting "for_each value is not known" at plan time.
#
# Without this delegation, terraform creates the Route53 zones and the MX/DKIM
# records inside them, but the outside world asks Cloudflare for
# <tenant>.thinkwork.ai and gets NXDOMAIN because Cloudflare doesn't know to
# delegate.
################################################################################

resource "cloudflare_record" "tenant_email_ns" {
  for_each = var.ses_parent_domain != "" && var.cloudflare_zone_id != "" ? {
    for pair in setproduct(sort(tolist(var.tenant_slugs)), range(4)) : "${pair[0]}-${pair[1]}" => {
      slug  = pair[0]
      index = pair[1]
    }
  } : {}

  zone_id = var.cloudflare_zone_id
  name    = "${each.value.slug}.${var.ses_parent_domain}"
  content = module.thinkwork.ses_tenant_name_servers[each.value.slug][each.value.index]
  type    = "NS"
  ttl     = 300
  proxied = false
}

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

output "lambda_artifact_mode" {
  description = "Resolved Lambda artifact source mode: local, s3, or placeholder."
  value       = module.thinkwork.lambda_artifact_mode
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
  description = "Mapbox public token used by apps/web MapView. Read by scripts/build-web.sh to inline VITE_MAPBOX_PUBLIC_TOKEN at build time; empty string lets MapView fall back to OpenStreetMap tiles."
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

output "cognee_enabled" {
  description = "Whether the Cognee ontology/KG add-on is enabled"
  value       = module.thinkwork.cognee_enabled
}

output "cognee_endpoint" {
  description = "Internal Cognee API endpoint (null when enable_cognee = false)"
  value       = module.thinkwork.cognee_endpoint
}

output "cognee_log_group_name" {
  description = "CloudWatch log group for Cognee (null when enable_cognee = false)"
  value       = module.thinkwork.cognee_log_group_name
}

output "cognee_brain_storage_tier" {
  description = "Company Brain storage tier (null when enable_cognee = false)"
  value       = module.thinkwork.cognee_brain_storage_tier
}

output "cognee_brain_instance_key" {
  description = "Tenant-scoped Company Brain instance key (null for legacy stage-wide instances)"
  value       = module.thinkwork.cognee_brain_instance_key
}

output "cognee_s3_artifact_root" {
  description = "Canonical Company Brain S3 source artifact root"
  value       = module.thinkwork.cognee_s3_artifact_root
}

output "cognee_neptune_graph_id" {
  description = "Neptune Analytics graph ID for production Company Brain"
  value       = module.thinkwork.cognee_neptune_graph_id
}

output "twenty_provisioned" {
  description = "Whether the Twenty CRM retained managed-app substrate is provisioned"
  value       = module.thinkwork.twenty_provisioned
}

output "twenty_runtime_enabled" {
  description = "Whether the Twenty CRM server/worker runtime is enabled"
  value       = module.thinkwork.twenty_runtime_enabled
}

output "twenty_url" {
  description = "Public Twenty CRM URL (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_url
}

output "twenty_cluster_arn" {
  description = "ECS cluster ARN for Twenty CRM (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_cluster_arn
}

output "twenty_server_service_name" {
  description = "ECS service name for the Twenty server (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_server_service_name
}

output "twenty_worker_service_name" {
  description = "ECS service name for the Twenty worker (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_worker_service_name
}

output "twenty_server_log_group_name" {
  description = "CloudWatch log group for the Twenty server (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_server_log_group_name
}

output "twenty_worker_log_group_name" {
  description = "CloudWatch log group for the Twenty worker (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_worker_log_group_name
}

output "twenty_cache_endpoint" {
  description = "ElastiCache primary endpoint for Twenty CRM (null when twenty_provisioned = false)"
  value       = module.thinkwork.twenty_cache_endpoint
}

output "plane_provisioned" {
  description = "Whether the Plane retained managed-app substrate is provisioned"
  value       = module.thinkwork.plane_provisioned
}

output "plane_runtime_enabled" {
  description = "Whether Plane ECS services are enabled"
  value       = module.thinkwork.plane_runtime_enabled
}

output "plane_url" {
  description = "Public Plane URL (null when plane_provisioned = false)"
  value       = module.thinkwork.plane_url
}

output "plane_cluster_arn" {
  description = "ECS cluster ARN for Plane (null when plane_provisioned = false)"
  value       = module.thinkwork.plane_cluster_arn
}

output "plane_web_service_name" {
  description = "ECS service name for Plane web (null when plane_provisioned = false)"
  value       = module.thinkwork.plane_web_service_name
}

output "plane_api_service_name" {
  description = "ECS service name for Plane API (null when plane_provisioned = false)"
  value       = module.thinkwork.plane_api_service_name
}

output "plane_cache_endpoint" {
  description = "ElastiCache primary endpoint for Plane (null when plane_provisioned = false)"
  value       = module.thinkwork.plane_cache_endpoint
}

output "plane_rabbitmq_broker_arn" {
  description = "Amazon MQ RabbitMQ broker ARN for Plane (null when plane_provisioned = false)"
  value       = module.thinkwork.plane_rabbitmq_broker_arn
}

output "agentcore_memory_id" {
  description = "AgentCore Memory resource ID used for automatic retention"
  value       = module.thinkwork.agentcore_memory_id
}

output "admin_url" {
  description = "Deprecated compatibility alias for app_url"
  value       = local.www_dns_enabled ? "https://${local.app_domain}" : "https://${module.thinkwork.app_distribution_domain}"
}

output "app_url" {
  description = "End-user app URL"
  value       = local.www_dns_enabled ? "https://${local.app_domain}" : "https://${module.thinkwork.app_distribution_domain}"
}

output "app_distribution_id" {
  description = "CloudFront distribution ID for app (for cache invalidation)"
  value       = module.thinkwork.app_distribution_id
}

output "app_bucket_name" {
  description = "S3 bucket for app assets"
  value       = module.thinkwork.app_bucket_name
}

output "deployment_state_machine_arn" {
  description = "Deployment orchestration Step Functions state machine ARN."
  value       = module.thinkwork.deployment_state_machine_arn
}

output "deployment_state_machine_name" {
  description = "Deployment orchestration Step Functions state machine name."
  value       = module.thinkwork.deployment_state_machine_name
}

output "deployment_runner_project_name" {
  description = "CodeBuild project name for the deployment runner."
  value       = module.thinkwork.deployment_runner_project_name
}

output "deployment_runner_project_arn" {
  description = "CodeBuild project ARN for the deployment runner."
  value       = module.thinkwork.deployment_runner_project_arn
}

output "deployment_evidence_bucket_name" {
  description = "S3 bucket for deployment evidence artifacts."
  value       = module.thinkwork.deployment_evidence_bucket_name
}

output "computer_url" {
  description = "Deprecated alias for app_url"
  value       = local.www_dns_enabled ? "https://${local.app_domain}" : "https://${module.thinkwork.app_distribution_domain}"
}

output "computer_distribution_id" {
  description = "Deprecated alias for app_distribution_id"
  value       = module.thinkwork.computer_distribution_id
}

output "computer_bucket_name" {
  description = "Deprecated alias for app_bucket_name"
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

output "ses_inbound_zone_ids" {
  description = "Route53 hosted zone IDs for tenant email subdomains, keyed by tenant slug"
  value       = module.thinkwork.ses_inbound_zone_ids
}

output "ses_inbound_zone_id" {
  description = "Route53 hosted zone ID for the legacy email subdomain (null when ses_inbound_domain is not set)"
  value       = module.thinkwork.ses_inbound_zone_id
}

output "ses_tenant_name_servers" {
  description = "Name servers for delegated tenant email subzones, keyed by tenant slug. Published to Cloudflare when cloudflare_zone_id is set."
  value       = module.thinkwork.ses_tenant_name_servers
}

output "ses_inbound_name_servers" {
  description = "Name servers for the legacy delegated email subzone."
  value       = module.thinkwork.ses_inbound_name_servers
}

output "ses_inbound_mx_target" {
  description = "MX target host for tenant email subdomains. Already written into each subzone by Terraform — informational."
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

output "customer_domain_name_servers" {
  description = "The four Route53 name servers for the customer-domain zone — publish these via the claim tool's `claim --set-targets` to delegate (empty when no customer domain is configured)."
  value       = module.thinkwork.customer_domain_name_servers
}
