variable "stage" {
  description = "Deployment stage (dev, prod, etc.)."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "account_id" {
  description = "AWS account ID (used to construct IAM + Lambda + state-machine ARNs)."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention for interpreter state machine executions."
  type        = number
  default     = 30
}

variable "execution_callback_lambda_arn" {
  description = "ARN of the workflow-execution-callback Lambda. EventBridge sends SFN execution-state-change events here so workflow_runs lifecycle status mirrors the SFN-side reality. Only consumed when enable_execution_callback is true."
  type        = string
  default     = ""
}

variable "enable_execution_callback" {
  description = "Provision the EventBridge SFN-state-change rule targeting the execution-callback Lambda. Must be a STATIC value (never derived from a computed resource attribute): it gates resource count, and Terraform cannot plan a count that depends on attributes only known after apply — the ARN itself is fine to consume inside the resources."
  type        = bool
  default     = false
}
