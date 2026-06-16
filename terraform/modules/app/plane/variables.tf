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
  description = "Subnet IDs for the managed Plane Valkey/Redis cache. Defaults to subnet_ids when omitted."
  type        = list(string)
  default     = []
}

variable "queue_subnet_ids" {
  description = "Subnet IDs for the managed Plane RabbitMQ broker. Defaults to subnet_ids when omitted."
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
  description = "Plane all-in-one runtime image URI pinned to a reviewed immutable digest."
  type        = string
  default     = ""

  validation {
    condition     = var.image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "frontend_image_uri" {
  description = "Deprecated per-service Plane frontend image URI. The compact AIO runtime uses image_uri."
  type        = string
  default     = ""

  validation {
    condition     = var.frontend_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.frontend_image_uri))
    error_message = "frontend_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "backend_image_uri" {
  description = "Deprecated per-service Plane backend image URI. The compact AIO runtime uses image_uri."
  type        = string
  default     = ""

  validation {
    condition     = var.backend_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.backend_image_uri))
    error_message = "backend_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "space_image_uri" {
  description = "Deprecated per-service Plane Space image URI. The compact AIO runtime uses image_uri."
  type        = string
  default     = ""

  validation {
    condition     = var.space_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.space_image_uri))
    error_message = "space_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "admin_image_uri" {
  description = "Deprecated per-service Plane admin image URI. The compact AIO runtime uses image_uri."
  type        = string
  default     = ""

  validation {
    condition     = var.admin_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.admin_image_uri))
    error_message = "admin_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "live_image_uri" {
  description = "Deprecated per-service Plane live image URI. The compact AIO runtime uses image_uri."
  type        = string
  default     = ""

  validation {
    condition     = var.live_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.live_image_uri))
    error_message = "live_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "mcp_image_uri" {
  description = "Plane MCP server runtime image URI pinned to a reviewed immutable digest."
  type        = string
  default     = ""

  validation {
    condition     = var.mcp_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.mcp_image_uri))
    error_message = "mcp_image_uri must be empty or pinned to an immutable sha256 image digest."
  }
}

variable "redis_image_uri" {
  description = "Deprecated no-op. Plane uses managed ElastiCache Valkey/Redis for REDIS_URL."
  type        = string
  default     = ""
}

variable "rabbitmq_image_uri" {
  description = "Deprecated no-op. Plane uses Amazon MQ for RabbitMQ for AMQP_URL."
  type        = string
  default     = ""
}

variable "runtime_enabled" {
  description = "Whether the compact Plane ECS service should run. Set false to park runtime while retaining data resources."
  type        = bool
  default     = true
}

variable "web_desired_count" {
  description = "Desired compact Plane ECS service task count when runtime_enabled is true"
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
  description = "Fargate task CPU units for the compact Plane task"
  type        = number
  default     = 2048
}

variable "memory" {
  description = "Fargate task memory in MB for the compact Plane task"
  type        = number
  default     = 4096
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
  description = "Plane AIO container port exposed through the public ALB"
  type        = number
  default     = 8080
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
  default     = 3000
}

variable "mcp_container_port" {
  description = "Plane MCP server HTTP port"
  type        = number
  default     = 8211
}

variable "redis_container_port" {
  description = "Deprecated compatibility value. Plane uses cache_port for managed Valkey/Redis."
  type        = number
  default     = 6379
}

variable "rabbitmq_container_port" {
  description = "Amazon MQ RabbitMQ secure AMQP listener port."
  type        = number
  default     = 5671
}

variable "rabbitmq_username" {
  description = "Amazon MQ RabbitMQ username used by Plane."
  type        = string
  default     = "plane"
}

variable "rabbitmq_password" {
  description = "Optional Amazon MQ RabbitMQ password. Leave empty to generate a Terraform-managed password."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = var.rabbitmq_password == "" || length(var.rabbitmq_password) >= 12
    error_message = "rabbitmq_password must be empty or at least 12 characters."
  }
}

variable "rabbitmq_vhost" {
  description = "RabbitMQ vhost path used in Plane's AMQP_URL. Amazon MQ creates the default / vhost."
  type        = string
  default     = "/"
}

variable "rabbitmq_erlang_cookie" {
  description = "Deprecated no-op. Amazon MQ manages RabbitMQ internals."
  type        = string
  default     = "thinkwork-plane-rabbitmq-cookie"
}

variable "web_command" {
  description = "Container command for the Plane web service"
  type        = list(string)
  default     = []
}

variable "api_command" {
  description = "Container command for the Plane API service"
  type        = list(string)
  default = [
    "/bin/bash",
    "-lc",
    "python manage.py wait_for_db && python manage.py migrate && /code/bin/docker-entrypoint-api.sh",
  ]
}

variable "worker_command" {
  description = "Container command for the Plane worker service"
  type        = list(string)
  default     = ["/code/bin/docker-entrypoint-worker.sh"]
}

variable "beat_worker_command" {
  description = "Container command for the Plane beat worker service"
  type        = list(string)
  default     = ["/code/bin/docker-entrypoint-beat.sh"]
}

variable "live_command" {
  description = "Container command for the Plane live service"
  type        = list(string)
  default     = []
}

variable "mcp_command" {
  description = "Container command for the Plane MCP HTTP server"
  type        = list(string)
  default     = ["uvx", "plane-mcp-server==0.2.8", "http"]
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
  description = "Deprecated no-op. Plane creates an AMQP_URL secret from the managed Amazon MQ broker endpoint."
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
  description = "ElastiCache engine for Plane. Prefer valkey; redis is available as a compatibility fallback."
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
  description = "ElastiCache node type for the Plane cache."
  type        = string
  default     = "cache.t4g.micro"
}

variable "cache_port" {
  description = "ElastiCache Redis-compatible port."
  type        = number
  default     = 6379
}

variable "cache_num_cache_clusters" {
  description = "Number of cache nodes in the replication group. Use 1 for the smallest v1 deployment."
  type        = number
  default     = 1
}

variable "cache_transit_encryption_enabled" {
  description = "Enable in-transit encryption for the Plane cache."
  type        = bool
  default     = true
}

variable "rabbitmq_engine_version" {
  description = "Amazon MQ RabbitMQ engine version."
  type        = string
  default     = "3.13"
}

variable "rabbitmq_instance_type" {
  description = "Amazon MQ RabbitMQ broker instance type. mq.m7g.medium is the smallest current RabbitMQ option in us-east-1."
  type        = string
  default     = "mq.m7g.medium"
}

variable "rabbitmq_admin_username" {
  description = "Deprecated compatibility value. Use rabbitmq_username."
  type        = string
  default     = "plane"
}

variable "rabbitmq_deployment_mode" {
  description = "Amazon MQ RabbitMQ deployment mode."
  type        = string
  default     = "SINGLE_INSTANCE"

  validation {
    condition     = contains(["SINGLE_INSTANCE", "CLUSTER_MULTI_AZ"], var.rabbitmq_deployment_mode)
    error_message = "rabbitmq_deployment_mode must be SINGLE_INSTANCE or CLUSTER_MULTI_AZ."
  }
}

variable "rabbitmq_auto_minor_version_upgrade" {
  description = "Allow Amazon MQ to apply compatible RabbitMQ minor version upgrades during maintenance windows."
  type        = bool
  default     = true
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
