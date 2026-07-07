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
  description = "ARN of the workflow-execution-callback Lambda. EventBridge sends SFN execution-state-change events here so workflow_runs lifecycle status mirrors the SFN-side reality. When empty, the EventBridge rule is not provisioned (lets this substrate module apply before the lambda-api module defines the function)."
  type        = string
  default     = ""
}
