variable "enabled" {
  description = "Create the AgentCore Harness execution IAM surface. The role is independent of whether a managed tenant/profile runtime is enabled."
  type        = bool
  default     = true
}

variable "stage" {
  description = "Deployment stage (dev, prod, etc.)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "bucket_name" {
  description = "Stage workspace S3 bucket name — Harness microVMs read tenant skill sources under tenants/*"
  type        = string
}

variable "managed_runtime_enabled" {
  description = "Reconcile the managed tenant/profile AgentCore Harness runtime. The base IAM role may remain enabled while this is false."
  type        = bool
  default     = false
}

variable "tenant_slug" {
  description = "Tenant slug whose skill prefix and managed Harness profile are admitted."
  type        = string
  default     = ""

  validation {
    condition     = var.tenant_slug == "" || can(regex("^[a-z0-9][a-z0-9-]{0,47}$", var.tenant_slug))
    error_message = "tenant_slug must be a lowercase slug up to 48 characters."
  }
}

variable "trust_profile" {
  description = "Stable execution/trust profile. Ordinary agent/user/tool differences do not create more Harnesses."
  type        = string
  default     = "default"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,31}$", var.trust_profile))
    error_message = "trust_profile must be a lowercase slug up to 32 characters."
  }
}

variable "discovery_url" {
  description = "OIDC discovery URL used by the Harness CUSTOM_JWT authorizer."
  type        = string
  default     = ""
}

variable "harness_audience" {
  description = "Exact audience accepted by the Harness CUSTOM_JWT authorizer."
  type        = string
  default     = ""
}

variable "gateway_arn" {
  description = "Exact selected AgentCore Gateway ARN exposed as the native Harness tool."
  type        = string
  default     = ""
}

variable "oauth_credential_provider_arn" {
  description = "Identity provider ARN used for the Harness on-behalf-of Gateway token exchange."
  type        = string
  default     = ""
}

variable "oauth_credential_secret_arn" {
  description = "AgentCore-managed Secrets Manager ARN backing the selected OAuth provider."
  type        = string
  default     = ""
  sensitive   = true
}

variable "oauth_return_url" {
  description = "Application callback that verifies the active user and completes AgentCore Identity OAuth session binding."
  type        = string
  default     = ""
}

variable "model_id" {
  description = "Safe baseline Bedrock model for the managed Harness profile. Per-turn trusted projection may narrow/replace it."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}
