################################################################################
# AgentCore Pi — App Module (variables)
#
# Provisions the Pi agent runtime as a Lambda+LWA function. Shared AgentCore
# platform substrate (ECR repo + async DLQ) is injected from the parent
# composition so Pi can carry its own IAM role, log group, Lambda function, and
# event-invoke config without duplicating shared resources.
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
  description = "ECR repository URL for AgentCore container images. Pi pulls the pi-latest / <sha>-pi image tags from this repo."
  type        = string
}

variable "source_image_uri" {
  description = "Optional release image URI to copy into ecr_repository_url:pi-latest before creating the Pi Lambda. Used by GitHub-free customer deployments."
  type        = string
  default     = ""
}

variable "async_dlq_arn" {
  description = "SQS DLQ ARN for failed `kind=run_skill` async invokes. Shared AgentCore queue for operator inspection."
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

variable "requester_idle_memory_learning_enabled" {
  description = "When true, requester memory learning runs through the API idle/dreaming pipeline instead of runtime retain-on-every-turn."
  type        = bool
  default     = false
}

variable "db_cluster_arn" {
  description = "Aurora DB cluster ARN. Injected as DB_CLUSTER_ARN so AuroraSessionStore (plan §005 U4) can target the cluster via the RDS Data API. The cluster's IAM resource scope (thinkwork-<stage>-db-* in agentcore-pi's role policy) covers any cluster-id suffix."
  type        = string
  default     = ""
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN for the Aurora cluster credentials. Injected as DB_SECRET_ARN so AuroraSessionStore can authenticate against the cluster via the RDS Data API. Matches the secret graphql-http already consumes — single source of truth."
  type        = string
  default     = ""
}

variable "okf_efs_enabled" {
  description = "When true, mount the generated OKF wiki EFS view into Pi. Requires subnet/security-group inputs and an access point ARN."
  type        = bool
  default     = false
}

variable "okf_efs_subnet_ids" {
  description = "Subnet IDs for the Pi Lambda VPC attachment used by the OKF wiki EFS mount."
  type        = list(string)
  default     = []
}

variable "okf_efs_security_group_ids" {
  description = "Security group IDs for the Pi Lambda VPC attachment used by the OKF wiki EFS mount."
  type        = list(string)
  default     = []
}

variable "okf_efs_file_system_arn" {
  description = "EFS file system ARN for read-only Pi OKF wiki access."
  type        = string
  default     = ""
}

variable "okf_efs_read_access_point_arn" {
  description = "EFS access point ARN mounted read-only by Pi for OKF wiki traversal."
  type        = string
  default     = ""
}

variable "okf_efs_mount_path" {
  description = "Local Lambda mount path for the OKF wiki EFS view. Must be under /mnt."
  type        = string
  default     = "/mnt/thinkwork-okf"
}
