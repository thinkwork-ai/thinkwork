variable "enabled" {
  description = "Master switch. When false the module creates nothing (ship-inert: U3 lands the broker code + this module gated off; U4 flips it on after the negative-egress proof)."
  type        = bool
  default     = false
}

variable "stage" {
  type = string
}

variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

# --- VPC placement (broker Lambda egress subnets + the dedicated VPCE) -------

variable "vpc_id" {
  type = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "subnet_ids" {
  description = "Private egress subnets the broker Lambda and its dedicated execute-api VPC endpoint attach to."
  type        = list(string)
  default     = []
}

# --- Evidence datastore (Aurora, RDS Data API — same cluster as graphql-http)-

variable "db_cluster_arn" {
  type    = string
  default = ""
}

variable "db_secret_arn" {
  type    = string
  default = ""
}

variable "db_cluster_endpoint" {
  description = "Aurora writer endpoint hostname — DATABASE_HOST for getDb() (evidence store + authorization loader)."
  type        = string
  default     = ""
}

variable "db_username" {
  description = "Aurora master username for the broker's DATABASE_URL."
  type        = string
  default     = "thinkwork_admin"
}

variable "db_password" {
  description = "Aurora master password for the broker's DATABASE_URL (synchronous getDb() path)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "database_name" {
  description = "Aurora database name for the broker's DATABASE_URL."
  type        = string
  default     = "thinkwork"
}

# --- Lambda artifact source (mirrors lambda-api's dual local/remote pattern) -

variable "lambda_zips_dir" {
  description = "Local path holding dist/lambdas/*.zip for local deploys. Empty when using remote S3 artifacts."
  type        = string
  default     = ""
}

variable "lambda_artifact_bucket" {
  type    = string
  default = ""
}

variable "lambda_artifact_prefix" {
  type    = string
  default = ""
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "log_retention_days" {
  type    = number
  default = 30
}
