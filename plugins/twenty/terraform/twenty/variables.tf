variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Twenty CRM networking"
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for the Twenty ECS tasks and public ALB. Public subnets provide outbound egress in phase 1."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) > 0
    error_message = "subnet_ids must include at least one public subnet for the Twenty ALB and ECS tasks."
  }
}

variable "cache_subnet_ids" {
  description = "Private subnet IDs for the ElastiCache subnet group. Leave empty to reuse subnet_ids in isolated test fixtures only."
  type        = list(string)
  default     = []
}

variable "storage_subnet_ids" {
  description = "Subnet IDs for EFS mount targets. Leave empty to reuse subnet_ids."
  type        = list(string)
  default     = []
}

variable "db_security_group_id" {
  description = "Security group ID for the shared PostgreSQL database instance"
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port for Twenty's dedicated database"
  type        = number
  default     = 5432
}

variable "public_url" {
  description = "Public HTTPS URL for Twenty, for example https://crm.example.com"
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.public_url))
    error_message = "public_url must be an HTTPS origin without a path, for example https://crm.example.com."
  }
}

variable "certificate_arn" {
  description = "ACM certificate ARN used by the public HTTPS ALB listener"
  type        = string

  validation {
    condition     = can(regex("^arn:aws(-[a-z]+)?:acm:[^:]+:[0-9]{12}:certificate/.+", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN."
  }
}

variable "image_uri" {
  description = "Twenty CRM container image URI pinned to a reviewed immutable digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be pinned to an immutable sha256 image digest."
  }
}

variable "runtime_enabled" {
  description = "Whether the Twenty server and worker should run. Set false to park runtime while retaining data resources."
  type        = bool
  default     = true
}

variable "server_desired_count" {
  description = "Desired Twenty server task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Desired Twenty worker task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "cpu" {
  description = "Fargate task CPU units for each Twenty task"
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate task memory in MB for each Twenty task"
  type        = number
  default     = 2048
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture for Twenty tasks"
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "container_port" {
  description = "Twenty server container port"
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "HTTP path used by ALB and container health checks"
  type        = string
  default     = "/healthz"
}

variable "health_check_grace_period_seconds" {
  description = "Seconds ECS ignores failing load balancer health checks while Twenty starts"
  type        = number
  default     = 300
}

variable "wait_for_steady_state" {
  description = "Whether Terraform waits for the Twenty ECS services to reach steady state"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Twenty services"
  type        = number
  default     = 14
}

variable "db_url_secret_arn" {
  description = "Secrets Manager ARN containing a JSON PG_DATABASE_URL field for Twenty's dedicated database."
  type        = string
  default     = ""
}

variable "encryption_key_secret_arn" {
  description = "Secrets Manager ARN containing a JSON ENCRYPTION_KEY field for Twenty."
  type        = string
  default     = ""
}

variable "fallback_encryption_key_secret_arn" {
  description = "Optional Secrets Manager ARN containing a JSON FALLBACK_ENCRYPTION_KEY field during key rotation."
  type        = string
  default     = ""
}

variable "app_secret_arn" {
  description = "Optional Secrets Manager ARN containing a JSON APP_SECRET field for legacy Twenty compatibility."
  type        = string
  default     = ""
}

variable "create_secret_placeholders" {
  description = "Create operator-owned Secrets Manager placeholder containers for missing Twenty secrets. Secret values are placeholders and ignored after creation so rotation survives Terraform applies."
  type        = bool
  default     = false
}

variable "kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt injected secrets"
  type        = list(string)
  default     = []
}

variable "email_from_address" {
  description = "Verified SES sender address for Twenty app emails. Leave empty to skip SMTP configuration."
  type        = string
  default     = ""
}

variable "email_from_name" {
  description = "Display name for Twenty app email From headers."
  type        = string
  default     = "ThinkWork CRM"
}

variable "email_smtp_host" {
  description = "SES SMTP host for Twenty app emails. Leave empty to use email-smtp.<region>.amazonaws.com."
  type        = string
  default     = ""
}

variable "email_smtp_port" {
  description = "SES SMTP port for Twenty app emails."
  type        = number
  default     = 587
}

variable "email_smtp_no_tls" {
  description = "Set true to disable TLS for Twenty SMTP. SES should use TLS."
  type        = bool
  default     = false
}

variable "cache_engine" {
  description = "ElastiCache engine. Prefer valkey; redis is available as a compatibility fallback."
  type        = string
  default     = "valkey"

  validation {
    condition     = contains(["valkey", "redis"], var.cache_engine)
    error_message = "cache_engine must be valkey or redis."
  }
}

variable "cache_engine_version" {
  description = "ElastiCache engine version for the selected cache engine"
  type        = string
  default     = "8.0"
}

variable "cache_parameter_group_family" {
  description = "ElastiCache parameter group family matching cache_engine/cache_engine_version"
  type        = string
  default     = "valkey8"
}

variable "cache_node_type" {
  description = "ElastiCache node type for the Twenty queue/cache"
  type        = string
  default     = "cache.t4g.micro"
}

variable "cache_port" {
  description = "ElastiCache Redis-compatible port"
  type        = number
  default     = 6379
}

variable "cache_num_cache_clusters" {
  description = "Number of cache nodes in the replication group. Use 1 for the smallest v1 deployment."
  type        = number
  default     = 1
}

variable "cache_transit_encryption_enabled" {
  description = "Enable in-transit encryption for the Twenty cache"
  type        = bool
  default     = true
}

variable "allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public Twenty HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_http_redirect" {
  description = "Whether the public ALB should redirect HTTP requests to HTTPS"
  type        = bool
  default     = true
}
