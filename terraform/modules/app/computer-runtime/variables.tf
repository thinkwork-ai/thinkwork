variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Computer runtime tasks and EFS"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for Computer runtime tasks and EFS mount targets"
  type        = list(string)
}

variable "api_auth_secret_arn" {
  description = "Optional Secrets Manager ARN for THINKWORK_API_SECRET injection. Empty keeps runtime secret wiring deferred to the manager."
  type        = string
  default     = ""
}

variable "default_cpu" {
  description = "Default Fargate CPU units for one Computer runtime task"
  type        = number
  default     = 256
}

variable "default_memory" {
  description = "Default Fargate memory MB for one Computer runtime task"
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Computer runtime tasks"
  type        = number
  default     = 7
}
