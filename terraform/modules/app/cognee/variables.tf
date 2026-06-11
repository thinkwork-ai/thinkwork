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
