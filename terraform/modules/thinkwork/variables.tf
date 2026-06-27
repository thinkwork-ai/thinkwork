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

variable "microsoft_oauth_client_id" {
  description = "Microsoft OAuth client ID reserved for future Cognito/OAuth wiring. Accepted here so deployment-control-plane generated wrappers stay forward-compatible."
  type        = string
  default     = ""
}

variable "microsoft_oauth_client_secret" {
  description = "Microsoft OAuth client secret reserved for future Cognito/OAuth wiring."
  type        = string
  sensitive   = true
  default     = ""
}

variable "microsoft_oauth_tenant" {
  description = "Microsoft OAuth tenant reserved for future Cognito/OAuth wiring."
  type        = string
  default     = "organizations"
}

variable "oidc_identity_providers" {
  description = "Additional Cognito OIDC identity providers for customer bootstrap."
  type = list(object({
    provider_name    = string
    client_id        = string
    client_secret    = string
    issuer_url       = string
    authorize_scopes = optional(string, "openid email profile")
    authorize_url    = optional(string, "")
    token_url        = optional(string, "")
    attributes_url   = optional(string, "")
    jwks_uri         = optional(string, "")
    attribute_mapping = optional(object({
      email    = optional(string, "email")
      name     = optional(string, "name")
      username = optional(string, "sub")
    }), {})
  }))
  default = []
}

variable "saml_identity_providers" {
  description = "Additional Cognito SAML identity providers for customer bootstrap."
  type = list(object({
    provider_name   = string
    metadata_url    = string
    idp_identifiers = optional(list(string), [])
    attribute_mapping = optional(object({
      email    = optional(string, "email")
      name     = optional(string, "name")
      username = optional(string, "NameID")
    }), {})
  }))
  default = []
}

variable "redirect_success_url" {
  description = "Default OAuth-callback redirect target when no per-request returnUrl is supplied. Mobile callers pass thinkwork:// custom scheme; web falls through to this."
  type        = string
  default     = "https://app.thinkwork.ai/settings/credentials"
}

variable "platform_operator_emails" {
  description = "Comma-separated allowlist of emails permitted to invoke operator-gated GraphQL mutations (updateTenantPolicy, sandbox fixture setup, etc.). Forwarded to graphql-http as THINKWORK_PLATFORM_OPERATOR_EMAILS. Empty ⇒ the gate rejects every call."
  type        = string
  default     = ""
}

variable "okf_wiki_efs_enabled" {
  description = "Provision the OKF Wiki Navigator EFS current-view substrate and mount it into the okf-efs-refresh Lambda plus Pi."
  type        = bool
  default     = true
}

variable "okf_wiki_create_vpc_endpoints" {
  description = "Create private AWS service VPC endpoints required by VPC-attached OKF hydrator and Pi Lambdas. Disable only when equivalent NAT or endpoints already exist."
  type        = bool
  default     = true
}

variable "okf_wiki_create_nat_gateway" {
  description = "Create NAT egress for private subnets when OKF EFS attaches Pi to the VPC. Disable only when equivalent public egress already exists."
  type        = bool
  default     = true
}

variable "enable_deployment_control_plane" {
  description = "Enable the AWS-native deployment control plane used for GitHub-free customer deployments."
  type        = bool
  default     = true
}

variable "deployment_state_machine_arn" {
  description = "Existing deployment orchestration Step Functions ARN for environments whose controller is bootstrapped outside this app stack."
  type        = string
  default     = ""
}

variable "deployment_evidence_bucket" {
  description = "Existing deployment evidence bucket for environments whose controller is bootstrapped outside this app stack."
  type        = string
  default     = ""
}

variable "deployment_release_version" {
  description = "Selected ThinkWork release version stored in the deployment control plane."
  type        = string
  default     = "unresolved"
}

variable "deployment_release_manifest_url" {
  description = "Selected ThinkWork release manifest URL stored in the deployment control plane."
  type        = string
  default     = ""
}

variable "deployment_release_manifest_sha256" {
  description = "Selected ThinkWork release manifest SHA-256 stored in the deployment control plane."
  type        = string
  default     = ""
}

variable "deployment_release_manifest_signature_url" {
  description = "Optional selected ThinkWork release manifest detached signature URL stored in the deployment control plane."
  type        = string
  default     = ""
}

variable "deployment_release_manifest_trust_policy" {
  description = "Release manifest trust policy for the deployment control plane: allow_unsigned_canary or require_signature."
  type        = string
  default     = "allow_unsigned_canary"

  validation {
    condition     = contains(["allow_unsigned_canary", "require_signature"], var.deployment_release_manifest_trust_policy)
    error_message = "deployment_release_manifest_trust_policy must be allow_unsigned_canary or require_signature."
  }
}

variable "deployment_release_manifest_trusted_keys_json" {
  description = "JSON array of trusted release signing keys for the deployment control plane."
  type        = string
  default     = "[]"

  validation {
    condition     = can(jsondecode(var.deployment_release_manifest_trusted_keys_json))
    error_message = "deployment_release_manifest_trusted_keys_json must be valid JSON."
  }
}

variable "deployment_terraform_state_bucket" {
  description = "Customer-owned S3 bucket used by the GitHub-free deployment runner for ThinkWork app Terraform state. Empty uses the legacy thinkwork-terraform-state bucket name."
  type        = string
  default     = ""
}

variable "deployment_terraform_lock_table" {
  description = "Customer-owned DynamoDB table used by the GitHub-free deployment runner for ThinkWork app Terraform state locking. Empty uses the legacy thinkwork-terraform-locks table name."
  type        = string
  default     = ""
}

variable "deployment_release_artifact_bucket" {
  description = "Customer-owned S3 bucket used by the GitHub-free deployment runner to stage release Lambda artifacts. Empty uses the legacy thinkwork-release-artifacts bucket name."
  type        = string
  default     = ""
}

variable "deployment_terraform_module_source" {
  description = "Terraform Registry source the GitHub-free deployment runner should use for the ThinkWork composite module."
  type        = string
  default     = "thinkwork-ai/thinkwork/aws"
}

variable "deployment_terraform_module_version" {
  description = "Terraform Registry module version the GitHub-free deployment runner should deploy. Empty derives from deployment_release_version."
  type        = string
  default     = ""
}

variable "deployment_control_plane_log_retention_days" {
  description = "CloudWatch log retention for deployment control-plane state machine and runner logs."
  type        = number
  default     = 30
}

variable "deployment_control_plane_create_secret_placeholders" {
  description = "Create placeholder Secrets Manager containers for deployment-control-plane bootstrap secrets."
  type        = bool
  default     = true
}

variable "bootstrap_credential_lease_kms_key_id" {
  description = "Optional KMS key ID or ARN used by Secrets Manager for temporary customer bootstrap credential leases. Empty uses the AWS-managed Secrets Manager key."
  type        = string
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

variable "existing_public_route_table_ids" {
  description = "Route table IDs for existing_public_subnet_ids when create_vpc = false. Used by gateway endpoints such as OKF S3 access."
  type        = list(string)
  default     = []
}

variable "existing_private_route_table_ids" {
  description = "Route table IDs for existing_private_subnet_ids when create_vpc = false. Used by gateway endpoints such as OKF S3 access."
  type        = list(string)
  default     = []
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
  description = "Enable Hindsight long-term memory. Full ThinkWork installs default this on because Hindsight is the canonical user and Space memory provider; set false only for explicit low-cost/development AgentCore-only deployments."
  type        = bool
  default     = true
}

variable "memory_engine" {
  description = "Active long-term memory engine for canonical recall/inspect/export. Exactly one engine is authoritative per deployment. Empty auto-selects Hindsight for full installs. Accepted values: 'hindsight' (requires enable_hindsight = true), 'agentcore' (explicit low-cost/development managed-memory mode), or legacy diagnostic 'cognee' (requires enable_cognee = true and is not the supported user/Space memory path). Legacy value 'managed' maps to 'agentcore'."
  type        = string
  default     = ""

  validation {
    condition     = var.memory_engine == "" || contains(["managed", "hindsight", "agentcore", "cognee"], var.memory_engine)
    error_message = "memory_engine must be empty, 'hindsight', 'agentcore', 'cognee', or legacy 'managed'."
  }

  validation {
    condition     = var.memory_engine != "cognee" || var.enable_cognee
    error_message = "memory_engine = 'cognee' requires enable_cognee = true."
  }
}

variable "hindsight_image_tag" {
  description = "Hindsight Docker image tag (used when enable_hindsight = true)"
  type        = string
  default     = "0.5.0"
}

variable "hindsight_enable_auto_consolidation" {
  description = "Run Hindsight's observation consolidation engine automatically after retain (used when enable_hindsight = true)."
  type        = bool
  default     = true
}

variable "hindsight_consolidation_dedup_threshold" {
  description = "Cosine-similarity threshold for Hindsight near-duplicate observation reconciliation (0.0-1.0; 1.0 disables)."
  type        = string
  default     = "0.97"
}

variable "hindsight_observations_mission" {
  description = "Service-level default observations mission for Hindsight consolidation. Empty string falls back to the image default. Per-bank config overrides apply on top."
  type        = string
  default     = "Synthesize durable, institutional facts about the business: customers, projects, decisions, processes, tools, relationships, and recurring patterns. Filter out ephemeral state, secrets, and personal small talk."
}

variable "enable_cognee" {
  description = "Enable Cognee as optional ThinkWork Brain ontology/knowledge-graph infrastructure. Cognee is plugin-managed Brain substrate infrastructure, not the supported user/Space memory provider."
  type        = bool
  default     = false
}

variable "cognee_image_uri" {
  description = "Cognee container image URI pinned to an immutable sha256 digest. Required when enable_cognee = true."
  type        = string
  default     = ""

  validation {
    condition     = var.cognee_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.cognee_image_uri))
    error_message = "cognee_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "cognee_db_username" {
  description = "Dedicated PostgreSQL username for Cognee metadata storage. Do not use the shared Aurora admin/master user."
  type        = string
  default     = "thinkwork_cognee"

  validation {
    condition     = !contains(["postgres", "thinkwork_admin", "rdsadmin"], lower(var.cognee_db_username))
    error_message = "cognee_db_username must be a dedicated least-privilege Cognee database user."
  }
}

variable "cognee_db_name" {
  description = "Dedicated PostgreSQL database name for Cognee metadata storage. Do not use the shared Thinkwork application database."
  type        = string
  default     = "thinkwork_cognee"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]{0,62}$", var.cognee_db_name))
    error_message = "cognee_db_name must be a valid PostgreSQL identifier."
  }
}

variable "cognee_db_password_secret_arn" {
  description = "Secrets Manager ARN containing a JSON password field for the dedicated Cognee PostgreSQL user. Required when enable_cognee = true."
  type        = string
  default     = ""
}

variable "cognee_allowed_internal_cidr_blocks" {
  description = "CIDR blocks allowed to reach the internal Cognee ALB"
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.cognee_allowed_internal_cidr_blocks :
      cidr != "0.0.0.0/0" && cidr != "::/0"
    ])
    error_message = "cognee_allowed_internal_cidr_blocks must not include all-network CIDRs such as 0.0.0.0/0 or ::/0."
  }
}

variable "cognee_allowed_internal_security_group_ids" {
  description = "Security group IDs allowed to reach the internal Cognee ALB"
  type        = list(string)
  default     = []
}

variable "cognee_backend_mode" {
  description = "Cognee backend mode. dogfood uses local graph/vector paths on EFS; remote requires remote graph/vector URLs."
  type        = string
  default     = "dogfood"

  validation {
    condition     = contains(["dogfood", "remote"], var.cognee_backend_mode)
    error_message = "cognee_backend_mode must be dogfood or remote."
  }
}

variable "cognee_desired_count" {
  description = "Desired number of Cognee ECS tasks. Dogfood/local backend mode must stay single-task."
  type        = number
  default     = 1
}

variable "cognee_brain_tenant_id" {
  description = "Tenant ID for a tenant-scoped Company Brain substrate instance. Empty preserves the legacy stage-wide Cognee resource names."
  type        = string
  default     = ""
}

variable "cognee_brain_instance_key" {
  description = "Stable tenant-scoped Brain instance key used to derive Cognee/Brain resource names."
  type        = string
  default     = ""
}

variable "cognee_brain_storage_tier" {
  description = "Company Brain storage tier: default or production."
  type        = string
  default     = "default"

  validation {
    condition     = contains(["default", "production"], var.cognee_brain_storage_tier)
    error_message = "cognee_brain_storage_tier must be default or production."
  }
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
  description = "Passed to Cognee CORS_ALLOWED_ORIGINS. Keep empty for internal-only Company Brain substrate."
  type        = string
  default     = ""
}

variable "cognee_llm_provider" {
  description = "Cognee LLM provider"
  type        = string
  default     = "bedrock"
}

variable "cognee_llm_model" {
  description = "Cognee LLM model"
  type        = string
  default     = "bedrock/amazon.nova-lite-v1:0"
}

variable "cognee_llm_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock LLM provider API key"
  type        = string
  default     = ""
}

variable "cognee_embedding_provider" {
  description = "Cognee embedding provider"
  type        = string
  default     = "bedrock"
}

variable "cognee_embedding_model" {
  description = "Cognee embedding model"
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "cognee_embedding_dimensions" {
  description = "Embedding vector dimensions. Must match the selected Cognee vector store."
  type        = number
  default     = 1024
}

variable "cognee_embedding_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock embedding provider API key"
  type        = string
  default     = ""
}

variable "cognee_vector_db_provider" {
  description = "Cognee vector store provider"
  type        = string
  default     = "lancedb"
}

variable "cognee_vector_db_url" {
  description = "Cognee vector store URL. Leave empty in dogfood mode to use the EFS-backed local default."
  type        = string
  default     = ""
}

variable "cognee_vector_db_key_secret_arn" {
  description = "Optional Secrets Manager ARN for a remote vector store key"
  type        = string
  default     = ""
}

variable "cognee_graph_database_provider" {
  description = "Cognee graph store provider"
  type        = string
  default     = "kuzu"
}

variable "cognee_graph_database_url" {
  description = "Cognee graph store URL. Leave empty in dogfood mode to use the EFS-backed local Kuzu default."
  type        = string
  default     = ""
}

variable "cognee_graph_database_username" {
  description = "Optional Cognee graph store username"
  type        = string
  default     = ""
}

variable "cognee_graph_database_password_secret_arn" {
  description = "Optional Secrets Manager ARN for a remote graph store password"
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
  description = "Explicit Bedrock model ARNs Cognee may invoke when a Bedrock LLM or embedding provider is selected."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.cognee_bedrock_model_resource_arns :
      arn != "*" && !can(regex("\\*", arn))
    ])
    error_message = "cognee_bedrock_model_resource_arns must list explicit model or inference-profile ARNs, not wildcards."
  }
}

variable "cognee_kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt Cognee-injected secrets"
  type        = list(string)
  default     = []
}

variable "twenty_provisioned" {
  description = "Provision the retained Twenty CRM managed-app substrate. Runtime can be parked independently with twenty_runtime_enabled."
  type        = bool
  default     = false
}

variable "twenty_runtime_enabled" {
  description = "Run Twenty CRM server/worker tasks when the retained substrate is provisioned. Set false to park runtime while retaining data resources."
  type        = bool
  default     = false
}

variable "twenty_image_uri" {
  description = "Twenty CRM container image URI pinned to an immutable sha256 digest. Required when twenty_provisioned = true."
  type        = string
  default     = ""

  validation {
    condition     = var.twenty_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.twenty_image_uri))
    error_message = "twenty_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "twenty_db_username" {
  description = "Dedicated PostgreSQL username for Twenty CRM. Do not use the shared Aurora admin/master user."
  type        = string
  default     = "thinkwork_twenty"

  validation {
    condition     = !contains(["postgres", "thinkwork_admin", "rdsadmin"], lower(var.twenty_db_username))
    error_message = "twenty_db_username must be a dedicated least-privilege Twenty database user."
  }
}

variable "twenty_db_name" {
  description = "Dedicated PostgreSQL database name for Twenty CRM. Do not use the shared Thinkwork application database."
  type        = string
  default     = "thinkwork_twenty"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]{0,62}$", var.twenty_db_name))
    error_message = "twenty_db_name must be a valid PostgreSQL identifier."
  }
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

variable "twenty_fallback_encryption_key_secret_arn" {
  description = "Optional Secrets Manager ARN containing a JSON FALLBACK_ENCRYPTION_KEY field during Twenty key rotation."
  type        = string
  default     = ""
}

variable "twenty_app_secret_arn" {
  description = "Optional Secrets Manager ARN containing a JSON APP_SECRET field for legacy Twenty compatibility."
  type        = string
  default     = ""
}

variable "twenty_email_domain" {
  description = "Verified SES domain used to derive Twenty's default noreply sender. Defaults to ses_inbound_domain."
  type        = string
  default     = ""
}

variable "twenty_email_from_address" {
  description = "Verified SES sender address for Twenty app emails. Defaults to noreply@<twenty_email_domain or ses_inbound_domain>."
  type        = string
  default     = ""
}

variable "twenty_email_from_name" {
  description = "Display name for Twenty app email From headers."
  type        = string
  default     = "ThinkWork CRM"
}

variable "twenty_email_smtp_host" {
  description = "SES SMTP host for Twenty app emails. Leave empty to use email-smtp.<region>.amazonaws.com."
  type        = string
  default     = ""
}

variable "twenty_domain" {
  description = "Public hostname for Twenty CRM. Leave empty to derive crm.<www_domain> when www_domain is set."
  type        = string
  default     = ""
}

variable "twenty_public_url" {
  description = "Public HTTPS URL for Twenty CRM. Leave empty to derive https://<twenty_domain>."
  type        = string
  default     = ""
}

variable "twenty_certificate_arn" {
  description = "ACM certificate ARN for the Twenty public ALB. Leave empty to reuse www_certificate_arn."
  type        = string
  default     = ""
}

variable "twenty_server_desired_count" {
  description = "Desired Twenty server task count when twenty_runtime_enabled is true."
  type        = number
  default     = 1
}

variable "twenty_worker_desired_count" {
  description = "Desired Twenty worker task count when twenty_runtime_enabled is true."
  type        = number
  default     = 1
}

variable "twenty_cache_engine" {
  description = "ElastiCache engine for Twenty. Prefer valkey; redis is available as a compatibility fallback."
  type        = string
  default     = "valkey"

  validation {
    condition     = contains(["valkey", "redis"], var.twenty_cache_engine)
    error_message = "twenty_cache_engine must be valkey or redis."
  }
}

variable "twenty_cache_engine_version" {
  description = "ElastiCache engine version for Twenty."
  type        = string
  default     = "8.0"
}

variable "twenty_cache_parameter_group_family" {
  description = "ElastiCache parameter group family matching twenty_cache_engine/twenty_cache_engine_version."
  type        = string
  default     = "valkey8"
}

variable "twenty_cache_node_type" {
  description = "ElastiCache node type for the Twenty queue/cache."
  type        = string
  default     = "cache.t4g.micro"
}

variable "twenty_cache_num_cache_clusters" {
  description = "Number of cache nodes in the Twenty replication group. Use 1 for the smallest v1 deployment."
  type        = number
  default     = 1
}

variable "twenty_allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public Twenty HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "twenty_kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt Twenty-injected secrets."
  type        = list(string)
  default     = []
}

variable "n8n_provisioned" {
  description = "Provision the retained n8n managed-app substrate. Runtime can be parked independently with n8n_runtime_enabled."
  type        = bool
  default     = false
}

variable "n8n_runtime_enabled" {
  description = "Run n8n main/worker tasks when the retained substrate is provisioned. Set false to park runtime while retaining data resources."
  type        = bool
  default     = false
}

variable "n8n_image_uri" {
  description = "Thin ThinkWork n8n wrapper image URI pinned to an immutable sha256 digest. Required when n8n_provisioned = true."
  type        = string
  default     = ""

  validation {
    condition     = var.n8n_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.n8n_image_uri))
    error_message = "n8n_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "n8n_database_admin_secret_arn" {
  description = "Secrets Manager ARN for an admin database credential allowed to create/drop the dedicated n8n database and role."
  type        = string
  default     = ""
}

variable "n8n_database_url_secret_arn" {
  description = "Secrets Manager ARN containing n8n's least-privilege database secret. Runtime injection expects JSON fields DATABASE_URL and DB_POSTGRESDB_PASSWORD."
  type        = string
  default     = ""
}

variable "n8n_database_username" {
  description = "Dedicated PostgreSQL username for n8n. Do not use the shared Aurora admin/master user."
  type        = string
  default     = "thinkwork_n8n"

  validation {
    condition     = !contains(["postgres", "thinkwork_admin", "rdsadmin"], lower(var.n8n_database_username))
    error_message = "n8n_database_username must be a dedicated least-privilege n8n database user."
  }
}

variable "n8n_database_name" {
  description = "Dedicated PostgreSQL database name for n8n. Do not use the shared Thinkwork application database."
  type        = string
  default     = "thinkwork_n8n"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]{0,62}$", var.n8n_database_name))
    error_message = "n8n_database_name must be a valid PostgreSQL identifier."
  }
}

variable "n8n_encryption_key_secret_arn" {
  description = "Secrets Manager ARN containing N8N_ENCRYPTION_KEY."
  type        = string
  default     = ""
}

variable "n8n_operator_secret_arn" {
  description = "Secrets Manager ARN containing the shared native n8n operator account credential."
  type        = string
  default     = ""
}

variable "n8n_service_credential_secret_arn" {
  description = "Secrets Manager ARN containing the tenant service credential used by the native n8n MCP integration."
  type        = string
  default     = ""
}

variable "n8n_storage_bucket_name" {
  description = "S3 bucket name used for n8n managed artifacts and optional storage mode objects. Required when n8n_provisioned = true."
  type        = string
  default     = ""
}

variable "n8n_create_storage_bucket" {
  description = "Create the S3 bucket named by n8n_storage_bucket_name. Set false to use an existing retained bucket."
  type        = bool
  default     = true
}

variable "n8n_storage_prefix" {
  description = "S3 prefix reserved for n8n managed artifacts."
  type        = string
  default     = "managed-apps/n8n"
}

variable "n8n_domain" {
  description = "Public hostname for n8n. Leave empty to derive n8n.<www_domain> when www_domain is set."
  type        = string
  default     = ""
}

variable "n8n_public_url" {
  description = "Public HTTPS URL for n8n. Leave empty to derive https://<n8n_domain>."
  type        = string
  default     = ""
}

variable "n8n_certificate_arn" {
  description = "ACM certificate ARN for the n8n public ALB. Leave empty to reuse www_certificate_arn."
  type        = string
  default     = ""
}

variable "n8n_main_desired_count" {
  description = "Desired n8n main task count when n8n_runtime_enabled is true."
  type        = number
  default     = 1
}

variable "n8n_worker_desired_count" {
  description = "Desired n8n worker task count when n8n_runtime_enabled is true."
  type        = number
  default     = 1
}

variable "n8n_worker_concurrency" {
  description = "n8n worker execution concurrency."
  type        = number
  default     = 10
}

variable "n8n_container_port" {
  description = "n8n HTTP listener/container port exposed through the public ALB."
  type        = number
  default     = 5678
}

variable "n8n_queue_mode" {
  description = "n8n queue mode toggle. THNK-50 requires queue mode."
  type        = bool
  default     = true
}

variable "n8n_task_runners_enabled" {
  description = "Enable n8n task runners for code-node execution."
  type        = bool
  default     = true
}

variable "n8n_package_config_digest" {
  description = "Digest of the reviewed custom-package configuration injected into the n8n wrapper image."
  type        = string
  default     = ""
}

variable "n8n_custom_package_specs" {
  description = "Pinned public npm package specs approved for n8n code nodes."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for spec in var.n8n_custom_package_specs :
      can(regex("^(@[^/]+/[^@]+|[^@]+)@[0-9][0-9A-Za-z.+-]*$", spec))
    ])
    error_message = "n8n_custom_package_specs must contain exact public npm specs such as lodash@4.17.21 or @scope/package@1.2.3."
  }
}

variable "n8n_execution_data_storage_mode" {
  description = "n8n execution data storage mode. OSS queue-mode defaults to database; s3 is reserved for a licensed enterprise deployment."
  type        = string
  default     = "database"

  validation {
    condition     = contains(["database", "s3"], var.n8n_execution_data_storage_mode)
    error_message = "n8n_execution_data_storage_mode must be database or s3."
  }
}

variable "n8n_binary_data_mode" {
  description = "n8n binary data mode. OSS queue-mode defaults to n8n's built-in default; s3 is reserved for a licensed enterprise deployment."
  type        = string
  default     = "default"

  validation {
    condition     = contains(["default", "filesystem", "s3"], var.n8n_binary_data_mode)
    error_message = "n8n_binary_data_mode must be default, filesystem, or s3."
  }
}

variable "n8n_cache_engine" {
  description = "ElastiCache engine for n8n. Prefer valkey; redis is available as a compatibility fallback."
  type        = string
  default     = "valkey"

  validation {
    condition     = contains(["valkey", "redis"], var.n8n_cache_engine)
    error_message = "n8n_cache_engine must be valkey or redis."
  }
}

variable "n8n_cache_engine_version" {
  description = "ElastiCache engine version for n8n."
  type        = string
  default     = "8.0"
}

variable "n8n_cache_parameter_group_family" {
  description = "ElastiCache parameter group family matching n8n_cache_engine/n8n_cache_engine_version."
  type        = string
  default     = "valkey8"
}

variable "n8n_cache_node_type" {
  description = "ElastiCache node type for the n8n queue."
  type        = string
  default     = "cache.t4g.micro"
}

variable "n8n_cache_num_cache_clusters" {
  description = "Number of n8n cache nodes in the replication group. Use 1 for the smallest v1 deployment."
  type        = number
  default     = 1
}

variable "n8n_allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public n8n HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "n8n_kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt n8n-injected secrets."
  type        = list(string)
  default     = []
}

variable "agentcore_memory_id" {
  description = "Optional pre-existing AgentCore Memory resource ID. When set, the agentcore-memory module skips provisioning and reuses this ID. Leave empty to auto-provision."
  type        = string
  default     = ""
}

variable "enable_workspace_orchestration" {
  description = "Enable S3 EventBridge/SQS routing for folder-native workspace orchestration. Also requires the per-tenant workspace_orchestration_enabled database flag before tenant events wake agents."
  type        = bool
  default     = false
}

variable "requester_idle_memory_learning_enabled" {
  description = "Enable requester-scoped 15-minute idle memory learning."
  type        = bool
  default     = false
}

variable "requester_memory_dreaming_enabled" {
  description = "Enable recurring requester memory dreaming sweeps."
  type        = bool
  default     = false
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

# ---------------------------------------------------------------------------
# Naming / Buckets
# ---------------------------------------------------------------------------

variable "bucket_name" {
  description = "Primary S3 bucket name"
  type        = string
  default     = ""
}

variable "billing_export_bucket_name" {
  description = "Optional S3 bucket containing AWS Data Exports/CUR 2.0 manifests for bill reconciliation. Empty leaves the scheduled reconciler in no-op mode."
  type        = string
  default     = ""
}

variable "billing_export_manifest_key" {
  description = "Optional S3 key for the latest AWS billing export manifest imported by the scheduled bill reconciler."
  type        = string
  default     = ""
}

variable "billing_reconciliation_tolerance_usd" {
  description = "Absolute USD tolerance used when comparing ThinkWork projected aggregate spend to AWS billing export spend."
  type        = number
  default     = 0.01
}

variable "plugin_catalog_github_token_secret_arn" {
  description = "Optional Secrets Manager ARN/name containing a GitHub token for API plugin catalog release-asset fetches. Empty uses unauthenticated GitHub requests."
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

variable "agentcore_pi_source_image_uri" {
  description = "Optional release image URI copied into the stage AgentCore ECR repository before creating the Pi Lambda."
  type        = string
  default     = ""
}

variable "require_lambda_artifacts" {
  description = "Fail planning unless either lambda_zips_dir or lambda_artifact_bucket/lambda_artifact_prefix is configured. Enterprise deployment repos should set this to true."
  type        = bool
  default     = false
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
  type = list(string)
  default = [
    "http://localhost:5174",
    "http://localhost:5174/auth/callback",
    "http://localhost:5175",
    "http://localhost:5175/auth/callback",
    "http://127.0.0.1:42010/callback",
    "http://localhost:42010/callback",
  ]
}

variable "admin_logout_urls" {
  type = list(string)
  default = [
    "http://localhost:5174",
    "http://localhost:5175",
  ]
}

variable "desktop_callback_urls" {
  type = list(string)
  default = [
    "thinkwork://oauth/callback",
    "thinkwork-dev://oauth/callback",
    "thinkwork-canary://oauth/callback",
  ]
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

variable "cognito_custom_auth_lambda_zip" {
  description = "Path to the Cognito custom-auth challenge Lambda zip"
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

variable "app_domain" {
  description = "Canonical custom domain for the end-user app (e.g. app.thinkwork.ai). Leave empty to fall back to computer_domain for compatibility."
  type        = string
  default     = ""
}

variable "app_certificate_arn" {
  description = "ACM certificate ARN for the canonical end-user app domain (us-east-1, required for CloudFront custom domains). Leave empty to fall back to computer_certificate_arn for compatibility."
  type        = string
  default     = ""
}

variable "computer_domain" {
  description = "Deprecated compatibility domain for the end-user app (e.g. computer.thinkwork.ai). When app_domain is set, this domain should redirect to app_domain instead of serving the SPA directly."
  type        = string
  default     = ""
}

variable "computer_certificate_arn" {
  description = "Deprecated ACM certificate ARN for the compatibility computer domain. Prefer app_certificate_arn for new deployments."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Customer domain (<name>.thinkwork.ai — optional, customer deployments)
#
# Two-phase by design (the shared claim tool owns the Cloudflare apex zone;
# this module owns the customer-account half): setting customer_domain
# creates the Route53 zone + CAA record only — inert until the NS hop lands.
# Flipping customer_domain_delegated after delegation resolves mints +
# validates the ACM cert, aliases the customer domain onto the app
# distribution, and adds the customer-domain Cognito callback/logout entries
# alongside the legacy ones (the dual window). Flipping
# customer_domain_legacy_retired afterwards removes the legacy app
# callback/logout entries — retirement is a reviewable Terraform change,
# not a console edit.
#
# Setting customer_domain (with or without the gates) requires the caller to
# pass an aliased us-east-1 AWS provider:
#   providers = { aws.us_east_1 = aws.us_east_1 }
# ---------------------------------------------------------------------------

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

variable "computer_sandbox_domain" {
  description = "Custom domain for the LLM-fragment iframe substrate (e.g. sandbox.thinkwork.ai). Cross-origin from the computer SPA — load-bearing for the iframe-isolation security boundary documented in docs/specs/computer-ai-elements-contract-v1.md. Leave empty to skip provisioning the sandbox distribution."
  type        = string
  default     = ""
}

variable "computer_sandbox_certificate_arn" {
  description = "ACM certificate ARN for the sandbox domain (us-east-1, required for CloudFront custom domains)."
  type        = string
  default     = ""
}

variable "computer_sandbox_allowed_parent_origins" {
  description = "Comma-separated list of trusted web parent origins that may frame the sandbox iframe (e.g. 'https://thinkwork.ai,https://dev.thinkwork.ai'). Desktop custom-protocol origins are appended automatically. Wired into the sandbox CSP frame-ancestors directive AND mirrored at iframe-shell build time as __ALLOWED_PARENT_ORIGINS__. The two trust sets MUST stay in sync. Leave empty to allow only desktop custom-protocol parents."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# API Gateway (custom domain — optional)
# ---------------------------------------------------------------------------

variable "api_domain" {
  description = "Custom domain for the HTTP API Gateway (e.g. api.thinkwork.ai). Leave empty to keep only the default execute-api URL. When set, the www-dns module adds a SAN to the shared ACM cert and creates a Cloudflare CNAME pointing at the API Gateway regional domain."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Stripe billing
# ---------------------------------------------------------------------------

variable "stripe_price_ids_json" {
  description = "JSON object mapping internal plan names to Stripe price IDs for this stage, e.g. {\"starter\":\"price_...\",\"team\":\"price_...\"}. Non-secret; per-stage. Exposed to Lambdas as STRIPE_PRICE_IDS_JSON env var. The secret_key, publishable_key, and webhook_signing_secret live in Secrets Manager at thinkwork/<stage>/stripe/api-credentials — never in tfvars."
  type        = string
  default     = "{}"
}

variable "enable_stripe_billing" {
  description = "Provision Stripe billing Lambdas, API routes, and credentials placeholder secret."
  type        = bool
  default     = true
}

variable "enable_slack_workspace_app" {
  description = "Provision Slack workspace app Lambdas, API routes, and credentials placeholder secret."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# SES inbound email (delegated tenant subzones — Option A)
# ---------------------------------------------------------------------------

variable "ses_parent_domain" {
  description = "Parent domain used for tenant email subdomains (e.g. thinkwork.ai). Leave empty to skip SES inbound resources."
  type        = string
  default     = ""
}

variable "ses_inbound_domain" {
  description = "Legacy delegated subdomain used for agent email (e.g. agents.thinkwork.ai). Kept until legacy-address retirement notices are no longer needed."
  type        = string
  default     = ""
}

variable "ses_tenant_slugs" {
  description = "Tenant slugs to provision as SES receiving subdomains under ses_parent_domain. Each slug creates <slug>.<ses_parent_domain>."
  type        = set(string)
  default     = []
}

variable "ses_manage_active_rule_set" {
  description = "Activate the SES receipt rule set. Only ONE rule set can be active per region per AWS account; set false on secondary stages that share an account so they don't fight over activation."
  type        = bool
  default     = true
}

variable "cognito_email_source_arn" {
  description = "Verified SES identity ARN Cognito should use for user-pool emails. Empty keeps Cognito's default sender."
  type        = string
  default     = ""
}

variable "cognito_from_email_address" {
  description = "Optional Cognito From header, for example 'ThinkWork <noreply@example.com>'. Requires cognito_email_source_arn when set."
  type        = string
  default     = ""
}

variable "cognito_reply_to_email_address" {
  description = "Optional Cognito Reply-To address for user-pool invitation and recovery emails."
  type        = string
  default     = ""
}

variable "cognito_invite_email_subject" {
  description = "Subject line for Cognito AdminCreateUser invitation emails."
  type        = string
  default     = "You're invited to ThinkWork"
}

variable "cognito_invite_email_message" {
  description = "HTML invitation body for Cognito AdminCreateUser emails. Empty derives a stage-aware ThinkWork sign-in message. Custom values must include {username} and {####}."
  type        = string
  default     = ""

  validation {
    condition = (
      var.cognito_invite_email_message == "" ||
      (
        strcontains(var.cognito_invite_email_message, "{username}") &&
        strcontains(var.cognito_invite_email_message, "{####}")
      )
    )
    error_message = "cognito_invite_email_message must be empty or include Cognito placeholders {username} and {####}."
  }
}

variable "cognito_invite_sms_message" {
  description = "SMS invitation body for Cognito AdminCreateUser messages. Must include {username} and {####} so Cognito can send the temporary password."
  type        = string
  default     = "Your ThinkWork username is {username} and temporary password is {####}."

  validation {
    condition     = strcontains(var.cognito_invite_sms_message, "{username}") && strcontains(var.cognito_invite_sms_message, "{####}")
    error_message = "cognito_invite_sms_message must include Cognito placeholders {username} and {####}."
  }
}

variable "wiki_compile_model_id" {
  description = "Bedrock model id used by the wiki-compile Lambda (leaf planner + aggregation planner + section writer). Any Converse-compatible model works; change without a code deploy."
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "company_brain_source_agent_model_id" {
  description = "Bedrock model id used by GraphQL Company Brain source agents for JSON tool/action turns. Defaults to Claude Haiku for reliable action output while the wiki compiler can remain on gpt-oss for throughput."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "company_brain_backdoor_install_key_secret_arn" {
  description = "Optional Secrets Manager ARN containing the temporary Company Brain backdoor install key. Empty disables the backdoor; the raw key is never stored in tfvars or runtime-config."
  type        = string
  default     = ""
}

variable "company_brain_backdoor_install_key_stages" {
  description = "Comma-separated stage allowlist for the temporary Company Brain backdoor install key. Empty disables deployed backdoor redemption."
  type        = string
  default     = ""
}

variable "wiki_aggregation_pass_enabled" {
  description = "Feature flag for the wiki aggregation pass (parent section rollups + section promotion). 'true' to enable, anything else disables. Pinned in terraform so unrelated deploys don't reset it."
  type        = string
  default     = "true"
}

variable "wiki_deterministic_linking_enabled" {
  description = "Feature flag for deterministic compile-time link emission — parent-expander-derived city/journal links plus entity↔entity co-mention links. 'true' to enable, anything else disables. Precision-bounded: rollback is `DELETE FROM wiki_page_links WHERE context LIKE 'deterministic:%' OR context LIKE 'co_mention:%'`."
  type        = string
  default     = "true"
}

variable "google_places_api_key" {
  description = "Google Places API (New) key used by wiki-compile for POI → city/state/country hierarchy enrichment. Stored as SSM SecureString at /thinkwork/<stage>/google-places/api-key. Empty string = parameter created with a placeholder; operator populates via `aws ssm put-parameter --overwrite`. Compile gracefully degrades to metadata-only rows when the key is absent — never fails compile."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mapbox_public_token" {
  description = "Mapbox public pk.* token consumed by the apps/web MapView primitive (in @thinkwork/computer-stdlib) for inline map tile rendering inside generated applets. Flows from this variable → terraform output → scripts/build-web.sh → apps/web/.env.production as VITE_MAPBOX_PUBLIC_TOKEN. URL-restrict on the Mapbox dashboard to the deployed `computer.<apex>` host (and any dev hosts) — the token ships in the public Vite bundle, so URL allowlist is the security boundary. Empty string is acceptable: MapView falls back to OpenStreetMap tiles when the env var is unset, so dev environments without an operator-provisioned token still render maps."
  type        = string
  default     = ""
  sensitive   = true
}

variable "agentcore_code_interpreter_id" {
  description = "AgentCore Code Interpreter id used by routine-task-python for SFN python recipe states. Leave empty to fail closed until the stage has a routines-capable interpreter."
  type        = string
  default     = ""
}

variable "mcp_custom_domain" {
  description = "MCP custom domain (e.g., 'mcp.thinkwork.ai'). Empty disables custom-domain setup — the MCP endpoint stays reachable at the API Gateway execute-api URL. When set, an ACM cert is created on the first apply; flip `mcp_custom_domain_ready = true` on a second apply after DNS validation completes. See docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md."
  type        = string
  default     = ""
}

variable "mcp_custom_domain_ready" {
  description = "Two-apply gate for the MCP custom domain. Leave false on the first apply (cert-only). After running `pnpm cf:sync-mcp` + waiting ~5 min for ACM validation, flip to true and re-apply to create the API Gateway domain + mapping."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Phase 3 U7 — Compliance audit-anchor bucket (S3 Object Lock)
# ---------------------------------------------------------------------------

variable "compliance_anchor_object_lock_mode" {
  description = "S3 Object Lock retention mode for the compliance audit-anchor bucket. GOVERNANCE allows a privileged role with s3:BypassGovernanceRetention to delete or shorten retention; COMPLIANCE is irreversible (even AWS root cannot delete or shorten until retention expires). Default GOVERNANCE per master plan Decision #2; flip to COMPLIANCE in prod tfvars at audit-engagement time."
  type        = string
  default     = "GOVERNANCE"

  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.compliance_anchor_object_lock_mode)
    error_message = "compliance_anchor_object_lock_mode must be either GOVERNANCE or COMPLIANCE."
  }
}

variable "compliance_anchor_retention_days" {
  description = "Default Object Lock retention in days for the compliance audit-anchor bucket. SOC2 Type 1 baseline is 12 months (365)."
  type        = number
  default     = 365

  validation {
    condition     = var.compliance_anchor_retention_days > 0
    error_message = "compliance_anchor_retention_days must be greater than 0."
  }
}
