variable "stage" {
  description = "Deployment stage (for example dev or prod)."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for n8n networking."
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for the n8n public ALB and phase-1 ECS task egress pattern."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) > 0
    error_message = "subnet_ids must include at least one public subnet for the n8n ALB and ECS tasks."
  }
}

variable "cache_subnet_ids" {
  description = "Private subnet IDs for the n8n managed Valkey/Redis subnet group. Leave empty to reuse subnet_ids in isolated fixtures only."
  type        = list(string)
  default     = []
}

variable "db_security_group_id" {
  description = "Security group ID for the shared PostgreSQL database instance."
  type        = string
}

variable "database_host" {
  description = "Hostname for the existing ThinkWork PostgreSQL instance."
  type        = string
}

variable "database_port" {
  description = "PostgreSQL port for n8n's dedicated database."
  type        = number
  default     = 5432
}

variable "database_name" {
  description = "Dedicated PostgreSQL database name for n8n."
  type        = string
  default     = "thinkwork_n8n"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]{0,62}$", var.database_name))
    error_message = "database_name must be a valid PostgreSQL identifier."
  }
}

variable "database_username" {
  description = "Dedicated PostgreSQL username for n8n. Do not use the shared Aurora admin/master user."
  type        = string
  default     = "thinkwork_n8n"

  validation {
    condition     = !contains(["postgres", "thinkwork_admin", "rdsadmin"], lower(var.database_username))
    error_message = "database_username must be a dedicated least-privilege n8n database user."
  }
}

variable "database_admin_secret_arn" {
  description = "Secrets Manager ARN for an admin database credential used by the managed-app setup step to create/drop the n8n database and role."
  type        = string
  default     = ""
}

variable "database_url_secret_arn" {
  description = "Secrets Manager ARN containing n8n's least-privilege database secret. Runtime injection expects JSON fields DATABASE_URL and DB_POSTGRESDB_PASSWORD."
  type        = string
  default     = ""
}

variable "public_url" {
  description = "Public HTTPS origin for n8n, for example https://n8n.example.com."
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.public_url))
    error_message = "public_url must be an HTTPS origin without a path, for example https://n8n.example.com."
  }
}

variable "certificate_arn" {
  description = "ACM certificate ARN used by the public HTTPS ALB listener."
  type        = string

  validation {
    condition     = can(regex("^arn:aws(-[a-z]+)?:acm:[^:]+:[0-9]{12}:certificate/.+", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN."
  }
}

variable "image_uri" {
  description = "Thin ThinkWork n8n wrapper image URI pinned to a reviewed immutable digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be pinned to an immutable sha256 image digest."
  }
}

variable "runtime_enabled" {
  description = "Whether the n8n main and worker services should run. Set false to park runtime while retaining data resources."
  type        = bool
  default     = true
}

variable "main_desired_count" {
  description = "Desired n8n main service task count when runtime_enabled is true."
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Desired n8n worker service task count when runtime_enabled is true."
  type        = number
  default     = 1
}

variable "worker_concurrency" {
  description = "n8n worker execution concurrency."
  type        = number
  default     = 10
}

variable "cpu" {
  description = "Fargate task CPU units for each n8n task."
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate task memory in MB for each n8n task."
  type        = number
  default     = 2048
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture for n8n tasks."
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "container_port" {
  description = "n8n HTTP container port."
  type        = number
  default     = 5678
}

variable "health_check_path" {
  description = "HTTP path used by ALB and container health checks."
  type        = string
  default     = "/healthz"
}

variable "health_check_grace_period_seconds" {
  description = "Seconds ECS ignores failing load balancer health checks while n8n starts."
  type        = number
  default     = 300
}

variable "wait_for_steady_state" {
  description = "Whether Terraform waits for the n8n ECS services to reach steady state."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention for n8n services."
  type        = number
  default     = 14
}

variable "encryption_key_secret_arn" {
  description = "Secrets Manager ARN containing N8N_ENCRYPTION_KEY."
  type        = string
  default     = ""
}

variable "operator_secret_arn" {
  description = "Secrets Manager ARN containing the shared native n8n operator credential. Expected JSON fields are N8N_OPERATOR_EMAIL and N8N_OPERATOR_PASSWORD."
  type        = string
  default     = ""
}

variable "service_credential_secret_arn" {
  description = "Secrets Manager ARN containing the tenant service credential used by the native n8n MCP integration."
  type        = string
  default     = ""
}

variable "create_secret_placeholders" {
  description = "Create operator-owned Secrets Manager placeholder containers for missing n8n secrets. Placeholder values are generated once and ignored after creation so rotation survives Terraform applies."
  type        = bool
  default     = false
}

variable "operator_email" {
  description = "Default email stored in the generated operator placeholder secret when create_secret_placeholders is true."
  type        = string
  default     = "operator+n8n@thinkwork.ai"
}

variable "kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt injected secrets."
  type        = list(string)
  default     = []
}

variable "storage_bucket_name" {
  description = "S3 bucket name used for n8n managed exports, evidence, package artifacts, and future enterprise S3 storage mode."
  type        = string
}

variable "create_storage_bucket" {
  description = "Create the S3 bucket named by storage_bucket_name. Set false to use an existing retained bucket."
  type        = bool
  default     = true
}

variable "storage_prefix" {
  description = "S3 prefix reserved for n8n managed artifacts and optional storage mode objects."
  type        = string
  default     = "managed-apps/n8n"
}

variable "execution_data_storage_mode" {
  description = "n8n execution data storage mode. OSS queue-mode defaults to database; s3 is reserved for a licensed enterprise deployment."
  type        = string
  default     = "database"

  validation {
    condition     = contains(["database", "s3"], var.execution_data_storage_mode)
    error_message = "execution_data_storage_mode must be database or s3."
  }
}

variable "binary_data_mode" {
  description = "n8n binary data mode. OSS queue-mode defaults to database because filesystem mode is unsupported with workers; s3 is reserved for a licensed enterprise deployment."
  type        = string
  default     = "database"

  validation {
    condition     = contains(["database", "s3"], var.binary_data_mode)
    error_message = "binary_data_mode must be database or s3."
  }
}

variable "task_runners_enabled" {
  description = "Enable n8n task runners for code-node execution."
  type        = bool
  default     = true
}

variable "package_config_digest" {
  description = "Digest of the reviewed custom-package configuration injected into the n8n wrapper image."
  type        = string
  default     = ""
}

variable "custom_package_specs" {
  description = "Pinned public npm package specs approved for n8n code nodes. U4 builds these into the wrapper image."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for spec in var.custom_package_specs :
      can(regex("^(@[^/]+/[^@]+|[^@]+)@[0-9][0-9A-Za-z.+-]*$", spec))
    ])
    error_message = "custom_package_specs must contain exact public npm specs such as lodash@4.17.21 or @scope/package@1.2.3."
  }
}

variable "queue_mode" {
  description = "n8n queue mode toggle. THNK-50 requires queue mode; this variable remains explicit so managed-app plans can record it."
  type        = bool
  default     = true
}

variable "cache_engine" {
  description = "ElastiCache engine for n8n queue mode. Prefer valkey; redis is available as a compatibility fallback."
  type        = string
  default     = "valkey"

  validation {
    condition     = contains(["valkey", "redis"], var.cache_engine)
    error_message = "cache_engine must be valkey or redis."
  }
}

variable "cache_engine_version" {
  description = "ElastiCache engine version for the selected cache engine."
  type        = string
  default     = "8.0"
}

variable "cache_parameter_group_family" {
  description = "ElastiCache parameter group family matching cache_engine/cache_engine_version."
  type        = string
  default     = "valkey8"
}

variable "cache_node_type" {
  description = "ElastiCache node type for the n8n queue."
  type        = string
  default     = "cache.t4g.micro"
}

variable "cache_port" {
  description = "ElastiCache Redis-compatible port."
  type        = number
  default     = 6379
}

variable "cache_num_cache_clusters" {
  description = "Number of cache nodes in the n8n replication group. Use 1 for the smallest v1 deployment."
  type        = number
  default     = 1
}

variable "cache_transit_encryption_enabled" {
  description = "Enable in-transit encryption for the n8n cache."
  type        = bool
  default     = true
}

variable "allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public n8n HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_http_redirect" {
  description = "Create a port 80 listener that redirects HTTP to HTTPS."
  type        = bool
  default     = true
}
