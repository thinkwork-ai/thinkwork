variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

# ---------------------------------------------------------------------------
# BYO Aurora
# ---------------------------------------------------------------------------

variable "create_database" {
  description = "Whether to create a new Aurora cluster. Set to false to use an existing cluster."
  type        = bool
  default     = true
}

variable "existing_db_cluster_arn" {
  description = "ARN of an existing Aurora cluster (required when create_database = false)"
  type        = string
  default     = null
}

variable "existing_db_secret_arn" {
  description = "ARN of an existing Secrets Manager secret with DB credentials (required when create_database = false)"
  type        = string
  default     = null
}

variable "existing_db_endpoint" {
  description = "Endpoint of an existing Aurora cluster (required when create_database = false)"
  type        = string
  default     = null
}

variable "existing_db_security_group_id" {
  description = "Security group ID of an existing Aurora cluster (required when create_database = false)"
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Cluster Configuration (only used when create_database = true)
# ---------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID for the database security group"
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for the DB subnet group"
  type        = list(string)
  default     = []
}

variable "db_password" {
  description = "Master password for the Aurora cluster"
  type        = string
  sensitive   = true
  default     = ""
}

variable "database_name" {
  description = "Name of the database to create"
  type        = string
  default     = "thinkwork"
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version"
  type        = string
  default     = "15.10"
}

variable "min_capacity" {
  description = "Minimum ACU capacity for serverless v2"
  type        = number
  default     = 0.5
}

variable "max_capacity" {
  description = "Maximum ACU capacity for serverless v2"
  type        = number
  default     = 2
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}
