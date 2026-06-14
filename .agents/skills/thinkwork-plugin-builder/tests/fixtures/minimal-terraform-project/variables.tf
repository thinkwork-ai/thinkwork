variable "aws_region" {
  description = "AWS region for the fixture."
  type        = string
}

variable "raw_bucket_name" {
  description = "Name of the raw lakehouse bucket."
  type        = string
}

variable "glue_database_name" {
  description = "Name of the Glue catalog database."
  type        = string
}

variable "dagster_token_secret_arn" {
  description = "Secrets Manager ARN containing the Dagster integration token."
  type        = string
  sensitive   = true
}
