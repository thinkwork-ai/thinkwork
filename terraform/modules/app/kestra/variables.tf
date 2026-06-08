variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Kestra networking"
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for the Kestra ECS task and public ALB. Public subnets provide outbound egress in phase 1."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) > 0
    error_message = "subnet_ids must include at least one public subnet for the Kestra ALB and ECS task."
  }
}

variable "assign_public_ip" {
  description = "Whether the Kestra Fargate task receives a public IP for outbound AWS/API access in public subnets."
  type        = bool
  default     = true
}

variable "db_security_group_id" {
  description = "Security group ID for the shared PostgreSQL database instance"
  type        = string
}

variable "db_host" {
  description = "PostgreSQL host for Kestra repository and queue state"
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port for Kestra repository and queue state"
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "Dedicated PostgreSQL database name for Kestra. Do not use the shared ThinkWork application database."
  type        = string
  default     = "kestra"
}

variable "db_username" {
  description = "Dedicated PostgreSQL username for Kestra. Do not use the shared Aurora admin/master user."
  type        = string
  default     = "kestra"

  validation {
    condition     = !contains(["postgres", "thinkwork_admin", "rdsadmin"], lower(var.db_username))
    error_message = "db_username must be a dedicated least-privilege Kestra database user, not the shared admin/master user."
  }
}

variable "db_password_secret_arn" {
  description = "Secrets Manager ARN containing a JSON password field for the dedicated Kestra PostgreSQL user. Leave empty only when create_secret_placeholders = true."
  type        = string
  default     = ""
}

variable "basic_auth_secret_arn" {
  description = "Secrets Manager ARN containing JSON username and password fields for the Kestra UI/API basic-auth service credential. Leave empty only when create_secret_placeholders = true."
  type        = string
  default     = ""
}

variable "create_secret_placeholders" {
  description = "Create operator-owned Secrets Manager placeholder containers for missing Kestra secrets. Secret values are seeded with placeholders and ignored after creation so rotation survives Terraform applies."
  type        = bool
  default     = false
}

variable "kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt injected secrets"
  type        = list(string)
  default     = []
}

variable "public_url" {
  description = "Public HTTPS URL for Kestra, for example https://orchestrate.example.com"
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.public_url))
    error_message = "public_url must be an HTTPS origin without a path, for example https://orchestrate.example.com."
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
  description = "Kestra container image URI pinned to a reviewed immutable digest. The image must include the storage backend needed by storage_type."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be pinned to an immutable sha256 image digest."
  }
}

variable "runtime_enabled" {
  description = "Whether the Kestra service should run. Set false to park runtime while retaining database, storage, secrets, ALB, and configuration."
  type        = bool
  default     = true
}

variable "desired_count" {
  description = "Desired Kestra standalone task count when runtime_enabled is true. Keep at 1 until the runtime is split into dedicated server/worker components."
  type        = number
  default     = 1
}

variable "cpu" {
  description = "Fargate task CPU units for Kestra"
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate task memory in MB for Kestra"
  type        = number
  default     = 2048
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture for Kestra tasks"
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "container_port" {
  description = "Kestra UI/API container port"
  type        = number
  default     = 8080
}

variable "management_port" {
  description = "Kestra management port that exposes /health"
  type        = number
  default     = 8081
}

variable "health_check_path" {
  description = "HTTP path used by ALB health checks on the management port"
  type        = string
  default     = "/health"
}

variable "health_check_grace_period_seconds" {
  description = "Seconds ECS ignores failing load balancer health checks while Kestra starts"
  type        = number
  default     = 300
}

variable "wait_for_steady_state" {
  description = "Whether Terraform waits for the Kestra ECS service to reach steady state"
  type        = bool
  default     = true
}

variable "worker_thread_count" {
  description = "Kestra standalone worker thread count"
  type        = number
  default     = 64
}

variable "java_opts" {
  description = "JAVA_OPTS passed to the Kestra JVM"
  type        = string
  default     = "--add-opens java.base/java.nio=ALL-UNNAMED"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Kestra"
  type        = number
  default     = 14
}

variable "storage_bucket_name" {
  description = "Optional explicit S3 bucket name for Kestra internal storage. Leave empty to derive one from stage and AWS account."
  type        = string
  default     = ""
}

variable "storage_force_destroy" {
  description = "Whether Terraform may delete non-empty Kestra internal storage buckets during destroy. Enable only for explicitly approved destructive teardown."
  type        = bool
  default     = false
}

variable "storage_versioning_enabled" {
  description = "Whether S3 versioning is enabled for Kestra internal storage"
  type        = bool
  default     = true
}

variable "allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public Kestra HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_http_redirect" {
  description = "Whether the public ALB should redirect HTTP requests to HTTPS"
  type        = bool
  default     = true
}
