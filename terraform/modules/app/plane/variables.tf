variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Plane networking"
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for the Plane ECS tasks and public ALB. Public subnets provide outbound egress in phase 1."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) > 0
    error_message = "subnet_ids must include at least one public subnet for the Plane ALB and ECS tasks."
  }
}

variable "cache_subnet_ids" {
  description = "Private subnet IDs for the ElastiCache subnet group. Leave empty to reuse subnet_ids in isolated test fixtures only."
  type        = list(string)
  default     = []
}

variable "queue_subnet_ids" {
  description = "Private subnet IDs for the Amazon MQ RabbitMQ broker. Leave empty to reuse cache_subnet_ids/subnet_ids."
  type        = list(string)
  default     = []
}

variable "db_security_group_id" {
  description = "Security group ID for the shared PostgreSQL database instance"
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port for Plane's dedicated database"
  type        = number
  default     = 5432
}

variable "public_url" {
  description = "Public HTTPS URL for Plane, for example https://plane.example.com"
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.public_url))
    error_message = "public_url must be an HTTPS origin without a path, for example https://plane.example.com."
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
  description = "Plane container image URI pinned to a reviewed immutable digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be pinned to an immutable sha256 image digest."
  }
}

variable "runtime_enabled" {
  description = "Whether Plane ECS services should run. Set false to park runtime while retaining data resources."
  type        = bool
  default     = true
}

variable "web_desired_count" {
  description = "Desired Plane web task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "api_desired_count" {
  description = "Desired Plane API task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Desired Plane worker task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "beat_worker_desired_count" {
  description = "Desired Plane beat worker task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "live_desired_count" {
  description = "Desired Plane live task count when runtime_enabled is true"
  type        = number
  default     = 1
}

variable "cpu" {
  description = "Fargate task CPU units for each Plane task"
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate task memory in MB for each Plane task"
  type        = number
  default     = 2048
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture for Plane tasks"
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "web_container_port" {
  description = "Plane web container port exposed through the public ALB"
  type        = number
  default     = 3000
}

variable "api_container_port" {
  description = "Plane API container port"
  type        = number
  default     = 8000
}

variable "worker_container_port" {
  description = "Plane worker container port placeholder for ECS metadata"
  type        = number
  default     = 8000
}

variable "live_container_port" {
  description = "Plane live container port"
  type        = number
  default     = 3001
}

variable "web_command" {
  description = "Container command for the Plane web service"
  type        = list(string)
  default     = []
}

variable "api_command" {
  description = "Container command for the Plane API service"
  type        = list(string)
  default     = []
}

variable "worker_command" {
  description = "Container command for the Plane worker service"
  type        = list(string)
  default     = []
}

variable "beat_worker_command" {
  description = "Container command for the Plane beat worker service"
  type        = list(string)
  default     = []
}

variable "live_command" {
  description = "Container command for the Plane live service"
  type        = list(string)
  default     = []
}

variable "health_check_path" {
  description = "HTTP path used by ALB health checks"
  type        = string
  default     = "/"
}

variable "health_check_grace_period_seconds" {
  description = "Seconds ECS ignores failing load balancer health checks while Plane starts"
  type        = number
  default     = 300
}

variable "wait_for_steady_state" {
  description = "Whether Terraform waits for Plane ECS services to reach steady state"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Plane services"
  type        = number
  default     = 14
}

variable "db_url_secret_arn" {
  description = "Secrets Manager ARN containing a JSON DATABASE_URL field for Plane's dedicated database."
  type        = string
  default     = ""
}

variable "secret_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane SECRET_KEY."
  type        = string
  default     = ""
}

variable "live_server_secret_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane LIVE_SERVER_SECRET_KEY."
  type        = string
  default     = ""
}

variable "aes_secret_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane AES_SECRET_KEY."
  type        = string
  default     = ""
}

variable "amqp_url_secret_arn" {
  description = "Secrets Manager ARN containing Plane AMQP_URL."
  type        = string
  default     = ""
}

variable "s3_access_key_id_secret_arn" {
  description = "Secrets Manager ARN containing Plane AWS_ACCESS_KEY_ID for S3 uploads."
  type        = string
  default     = ""
}

variable "s3_secret_access_key_secret_arn" {
  description = "Secrets Manager ARN containing Plane AWS_SECRET_ACCESS_KEY for S3 uploads."
  type        = string
  default     = ""
}

variable "create_secret_placeholders" {
  description = "Create operator-owned Secrets Manager placeholder containers for missing Plane secrets. Secret values are placeholders and ignored after creation so rotation survives Terraform applies."
  type        = bool
  default     = false
}

variable "kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt injected secrets"
  type        = list(string)
  default     = []
}

variable "s3_bucket_name" {
  description = "S3 bucket name used for Plane file uploads."
  type        = string
}

variable "create_storage_bucket" {
  description = "Create the S3 bucket named by s3_bucket_name. Set false to use an existing bucket."
  type        = bool
  default     = true
}

variable "file_size_limit" {
  description = "Maximum Plane upload size in bytes."
  type        = number
  default     = 5242880
}

variable "enable_signup" {
  description = "Whether Plane self-service signup is enabled."
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
  description = "ElastiCache node type for the Plane cache"
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
  description = "Enable in-transit encryption for the Plane cache"
  type        = bool
  default     = true
}

variable "rabbitmq_engine_version" {
  description = "Amazon MQ RabbitMQ engine version for Plane."
  type        = string
  default     = "3.13"
}

variable "rabbitmq_instance_type" {
  description = "Amazon MQ broker instance type for Plane RabbitMQ."
  type        = string
  default     = "mq.t3.micro"
}

variable "rabbitmq_admin_username" {
  description = "Admin username Terraform creates on the Plane RabbitMQ broker."
  type        = string
  default     = "plane"
}

variable "allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public Plane HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_http_redirect" {
  description = "Whether the public ALB should redirect HTTP requests to HTTPS"
  type        = bool
  default     = true
}
