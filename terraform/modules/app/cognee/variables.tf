variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Cognee networking"
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for the Cognee ECS task and internal ALB. Public subnets provide outbound egress in phase 1; the ALB remains internal."
  type        = list(string)
}

variable "db_security_group_id" {
  description = "Security group ID for the shared PostgreSQL database"
  type        = string
}

variable "db_host" {
  description = "PostgreSQL host for Cognee metadata storage"
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port for Cognee metadata storage"
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "PostgreSQL database name for Cognee metadata storage"
  type        = string
  default     = "thinkwork"
}

variable "db_username" {
  description = "Dedicated PostgreSQL username for Cognee metadata storage. Do not use the shared Aurora admin/master user."
  type        = string

  validation {
    condition     = !contains(["postgres", "thinkwork_admin", "rdsadmin"], lower(var.db_username))
    error_message = "db_username must be a dedicated least-privilege Cognee database user, not the shared admin/master user."
  }
}

variable "db_password_secret_arn" {
  description = "Secrets Manager ARN containing a JSON password field for the Cognee PostgreSQL user. Leave empty only when create_secret_placeholders = true."
  type        = string
  default     = ""
}

variable "create_secret_placeholders" {
  description = "Create operator-owned Secrets Manager placeholder containers for missing Cognee secrets. Secret values are seeded with placeholders and ignored after creation so rotation survives Terraform applies."
  type        = bool
  default     = false
}

variable "allowed_internal_cidr_blocks" {
  description = "CIDR blocks allowed to reach the internal Cognee ALB. Leave empty to create the endpoint without caller ingress."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.allowed_internal_cidr_blocks :
      cidr != "0.0.0.0/0" && cidr != "::/0"
    ])
    error_message = "allowed_internal_cidr_blocks must not include all-network CIDRs such as 0.0.0.0/0 or ::/0."
  }
}

variable "allowed_internal_security_group_ids" {
  description = "Security group IDs allowed to reach the internal Cognee ALB"
  type        = list(string)
  default     = []
}

variable "image_uri" {
  description = "Cognee container image URI pinned to a reviewed immutable digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be pinned to an immutable sha256 image digest."
  }
}

variable "cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 2048
}

variable "memory" {
  description = "Fargate task memory in MB. 2048 OOM-crashed the dogfood task during cognify (Kuzu graph + LanceDB vectors + embedding/LLM client + extraction pipeline in one task); 8192 gives the single-task pipeline real headroom. Valid Fargate combo with cpu=2048 (4096-16384 MB)."
  type        = number
  default     = 8192
}

variable "desired_count" {
  description = "Desired number of Cognee ECS tasks. Dogfood/local backend mode must stay single-task."
  type        = number
  default     = 1
}

variable "brain_tenant_id" {
  description = "Tenant ID for a tenant-scoped Company Brain substrate instance. Empty preserves the legacy stage-wide Cognee resource names."
  type        = string
  default     = ""
}

variable "brain_instance_key" {
  description = "Stable tenant-scoped Brain instance key used to derive resource names. Empty falls back to brain_tenant_id, and both empty preserve legacy stage-wide names."
  type        = string
  default     = ""

  validation {
    condition     = var.brain_instance_key == "" || can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$", var.brain_instance_key))
    error_message = "brain_instance_key must be empty or a stable 1-48 character alphanumeric, underscore, or dash key."
  }
}

variable "brain_storage_tier" {
  description = "Company Brain storage tier: default uses local LanceDB/Kuzu-style stores; production uses Neptune Analytics graph/vector providers."
  type        = string
  default     = "default"

  validation {
    condition     = contains(["default", "production"], var.brain_storage_tier)
    error_message = "brain_storage_tier must be default or production."
  }
}

variable "brain_s3_artifact_root" {
  description = "Canonical Company Brain S3 root URI for source artifacts. Used as runner/status evidence; S3 is the replay source of truth."
  type        = string
  default     = ""
}

variable "brain_s3_manifest_root" {
  description = "Canonical Company Brain S3 root URI for ingestion manifests."
  type        = string
  default     = ""
}

variable "brain_s3_vault_projection_root" {
  description = "Canonical Company Brain S3 root URI for vault/materialized projections."
  type        = string
  default     = ""
}

variable "brain_artifacts_bucket_arn" {
  description = "Optional S3 bucket ARN for canonical Brain artifacts. When set with brain_artifacts_prefixes, the task role receives scoped object access."
  type        = string
  default     = ""
}

variable "brain_artifacts_prefixes" {
  description = "Tenant/stage prefixes inside brain_artifacts_bucket_arn the Brain task may access."
  type        = list(string)
  default     = []
}

variable "private_substrate_mode" {
  description = "Whether the Brain substrate is private/internal-only. Public substrate mode is intentionally unsupported for Company Brain."
  type        = bool
  default     = true
}

variable "require_authentication" {
  description = "Passed to Cognee REQUIRE_AUTHENTICATION. Defaults false for current internal ALB compatibility; Company Brain can set true when the runtime supports it."
  type        = bool
  default     = false
}

variable "enable_backend_access_control" {
  description = "Passed to Cognee ENABLE_BACKEND_ACCESS_CONTROL for private-substrate hardening."
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "Passed to Cognee CORS_ALLOWED_ORIGINS. Keep empty for internal-only Company Brain substrate."
  type        = string
  default     = ""
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture for the Cognee task"
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "container_port" {
  description = "Cognee API container port"
  type        = number
  default     = 8000
}

variable "health_check_path" {
  description = "HTTP path used by ALB health checks"
  type        = string
  default     = "/health"
}

variable "health_check_grace_period_seconds" {
  description = "Seconds ECS ignores failing load balancer health checks while Cognee starts"
  type        = number
  default     = 300
}

variable "wait_for_steady_state" {
  description = "Whether Terraform waits for the Cognee ECS service to reach steady state"
  type        = bool
  default     = true
}

variable "enable_execute_command" {
  description = "Enable `aws ecs execute-command` into the Cognee container (and grant the SSM-messages channel on the task role). The dogfood Cognee ALB is VPC-internal, so exec is the only way to introspect its store/API directly. Defaults on for the current dogfood/dev deployment; set false for hardened multi-tenant production."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the Cognee service"
  type        = number
  default     = 14
}

variable "backend_mode" {
  description = "Cognee backend mode. dogfood uses local graph/vector paths on EFS; remote requires remote graph/vector URLs."
  type        = string
  default     = "dogfood"

  validation {
    condition     = contains(["dogfood", "remote"], var.backend_mode)
    error_message = "backend_mode must be dogfood or remote."
  }
}

variable "llm_provider" {
  description = "Cognee LLM provider"
  type        = string
  default     = "bedrock"
}

variable "llm_model" {
  description = "Cognee LLM model"
  type        = string
  default     = "bedrock/amazon.nova-lite-v1:0"
}

variable "llm_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock LLM provider API key"
  type        = string
  default     = ""
}

variable "embedding_provider" {
  description = "Cognee embedding provider"
  type        = string
  default     = "bedrock"
}

variable "embedding_model" {
  description = "Cognee embedding model"
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "embedding_dimensions" {
  description = "Embedding vector dimensions. Must match the selected vector store."
  type        = number
  default     = 1024
}

variable "embedding_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock embedding provider API key"
  type        = string
  default     = ""
}

variable "embedding_max_completion_tokens" {
  description = "Optional embedding max token setting for Cognee"
  type        = string
  default     = ""
}

variable "vector_db_provider" {
  description = "Cognee vector store provider"
  type        = string
  default     = "lancedb"
}

variable "vector_db_url" {
  description = "Cognee vector store URL. Leave empty in dogfood mode to use the EFS-backed local default."
  type        = string
  default     = ""

  validation {
    condition = (
      var.vector_db_url == "" ||
      (
        !can(regex("://[^/?#]*@", var.vector_db_url)) &&
        !can(regex("[?&][^=]*(token|key|secret|password|pass)[^=]*=", lower(var.vector_db_url)))
      )
    )
    error_message = "vector_db_url must not embed credentials; use vector_db_key_secret_arn for secrets."
  }
}

variable "vector_db_key_secret_arn" {
  description = "Optional Secrets Manager ARN for a remote vector store key"
  type        = string
  default     = ""
}

variable "graph_database_provider" {
  description = "Cognee graph store provider"
  type        = string
  default     = "kuzu"
}

variable "graph_database_url" {
  description = "Cognee graph store URL. Leave empty in dogfood mode to use the EFS-backed local Kuzu default."
  type        = string
  default     = ""

  validation {
    condition = (
      var.graph_database_url == "" ||
      (
        !can(regex("://[^/?#]*@", var.graph_database_url)) &&
        !can(regex("[?&][^=]*(token|key|secret|password|pass)[^=]*=", lower(var.graph_database_url)))
      )
    )
    error_message = "graph_database_url must not embed credentials; use graph_database_password_secret_arn for secrets."
  }
}

variable "graph_database_username" {
  description = "Optional Cognee graph store username"
  type        = string
  default     = ""
}

variable "graph_database_password_secret_arn" {
  description = "Optional Secrets Manager ARN for a remote graph store password"
  type        = string
  default     = ""
}

variable "neptune_graph_id" {
  description = "Neptune Analytics graph ID used by the production Brain tier."
  type        = string
  default     = ""
}

variable "neptune_graph_arn" {
  description = "Optional Neptune Analytics graph ARN. When set, the task role receives scoped Neptune graph query access."
  type        = string
  default     = ""
}

variable "neptune_endpoint" {
  description = "Neptune Analytics endpoint used by the production Brain tier."
  type        = string
  default     = ""
}

variable "production_posture" {
  description = "Operator evidence string for production-tier approval/readiness posture."
  type        = string
  default     = ""
}

variable "bedrock_model_resource_arns" {
  description = "Explicit Bedrock model ARNs Cognee may invoke when a Bedrock LLM or embedding provider is selected."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.bedrock_model_resource_arns :
      arn != "*" && !can(regex("\\*", arn))
    ])
    error_message = "bedrock_model_resource_arns must list explicit model or inference-profile ARNs, not wildcards."
  }
}

variable "kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt injected secrets"
  type        = list(string)
  default     = []
}
