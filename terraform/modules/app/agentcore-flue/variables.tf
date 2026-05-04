################################################################################
# AgentCore Flue — App Module (variables)
#
# Plan §005 U2 — provisions the Flue agent runtime as a Lambda+LWA function
# (the same shape as the Strands runtime in `../agentcore-runtime`, NOT the
# Bedrock AgentCore Runtime ECR-substrate pattern in `../agentcore-code-
# interpreter`).
#
# ECR repo + async DLQ are shared with the Strands runtime — they're injected
# from `module.agentcore` outputs at the parent composition layer rather than
# being created here. This avoids a duplicate ECR repository and a parallel DLQ
# while still letting Flue carry its own IAM role, log group, Lambda function,
# and event-invoke config.
################################################################################

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

variable "bucket_name" {
  description = "Primary S3 bucket for skills and workspace files."
  type        = string
}

variable "ecr_repository_url" {
  description = "ECR repository URL for the AgentCore container image. Shared with the Strands runtime (thinkwork-<stage>-agentcore); the Flue runtime pulls the flue-latest / <sha>-flue image tags from this repo."
  type        = string
}

variable "async_dlq_arn" {
  description = "SQS DLQ ARN for failed `kind=run_skill` async invokes. Shared with the Strands runtime so operator inspection has a single queue to watch."
  type        = string
}

variable "hindsight_endpoint" {
  description = "Hindsight API endpoint. Empty string (default) disables Hindsight tools in the container; set to an endpoint URL to enable Hindsight as an add-on alongside the always-on managed memory."
  type        = string
  default     = ""
}

variable "agentcore_memory_id" {
  description = "AgentCore Memory resource ID. Populated automatically by the agentcore-memory module; injected into the container as AGENTCORE_MEMORY_ID for auto-retention."
  type        = string
  default     = ""
}

variable "api_endpoint" {
  description = "Deployed API Gateway base URL. Injected as THINKWORK_API_URL so the composition runner (run_skill dispatch) can POST terminal state back to /api/skills/complete."
  type        = string
  default     = ""
}

variable "api_auth_secret" {
  description = "Service-auth bearer shared secret. Injected as API_AUTH_SECRET so the composition runner can authenticate to /api/skills/complete. Matches the lambda-api module's value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "memory_engine" {
  description = "Active long-term memory engine ('hindsight' or 'agentcore'). Surfaced to the runtime as MEMORY_ENGINE for telemetry/debugging only; engine selection itself happens in the API's normalized memory layer when memory-retain is invoked."
  type        = string
  default     = "hindsight"
  validation {
    condition     = contains(["hindsight", "agentcore"], var.memory_engine)
    error_message = "memory_engine must be 'hindsight' or 'agentcore'."
  }
}
