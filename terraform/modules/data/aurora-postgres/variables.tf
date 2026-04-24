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

variable "database_engine" {
  description = "Database engine: 'aurora-serverless' (production, serverless v2) or 'rds-postgres' (dev/test, cheaper, single instance)"
  type        = string
  default     = "aurora-serverless"

  validation {
    condition     = contains(["aurora-serverless", "rds-postgres"], var.database_engine)
    error_message = "database_engine must be 'aurora-serverless' or 'rds-postgres'"
  }
}

variable "engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.10"
}

variable "min_capacity" {
  description = "Minimum ACU capacity for Aurora serverless v2 (ignored for rds-postgres)"
  type        = number
  default     = 0.5
}

variable "max_capacity" {
  description = "Maximum ACU capacity for Aurora serverless v2 (ignored for rds-postgres)"
  type        = number
  default     = 2
}

variable "rds_instance_class" {
  description = "Instance class for rds-postgres engine (ignored for aurora-serverless)"
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB for rds-postgres engine (ignored for aurora-serverless)"
  type        = number
  default     = 20
}

variable "deletion_protection" {
  description = "Enable deletion protection (defaults to true for aurora-serverless, false for rds-postgres)"
  type        = bool
  default     = null
}

# ---------------------------------------------------------------------------
# aws_s3 Aurora extension (optional — set backups_bucket_arn to enable)
# ---------------------------------------------------------------------------

variable "backups_bucket_arn" {
  description = "ARN of the S3 backups bucket Aurora should be allowed to write to via the aws_s3 extension (aws_s3.query_export_to_s3). When set, attaches an IAM role to the Aurora cluster granting s3:PutObject on that bucket. Null disables the feature. Only effective when database_engine = 'aurora-serverless'."
  type        = string
  default     = null
}
