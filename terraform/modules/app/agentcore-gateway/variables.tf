variable "enabled" {
  description = "Reconcile the non-production THINK-316 Gateway proof resources."
  type        = bool
  default     = false
}

variable "stage" {
  description = "Deployment stage."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "account_id" {
  description = "AWS account id."
  type        = string
}

variable "discovery_url" {
  description = "CUSTOM_JWT OIDC discovery URL for the purpose-bound Gateway assertion issuer."
  type        = string
}

variable "gateway_audience" {
  description = "Exact audience accepted by this proof Gateway."
  type        = string
}

variable "target_base_url" {
  description = "Owned HTTPS API base URL hosting the controlled proof target."
  type        = string
}

variable "oauth_credential_provider_arn" {
  description = "Exact AgentCore Identity OAuth provider ARN used for the target."
  type        = string
}

variable "oauth_credential_secret_arn" {
  description = "Exact AgentCore-managed secret backing the OAuth provider."
  type        = string
  sensitive   = true
}

variable "oauth_return_url" {
  description = "Application callback URL allowed for the 3LO user-federation flow."
  type        = string
}

variable "proof_owner_allowlist" {
  description = "Comma-separated exact OAuthUser subjects admitted by the proof Cedar policy."
  type        = string
  default     = ""
}

variable "observability_retention_days" {
  description = "Retention for AgentCore Gateway application logs delivered to CloudWatch."
  type        = number
  default     = 90

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653,
    ], var.observability_retention_days)
    error_message = "observability_retention_days must be a CloudWatch Logs-supported retention period."
  }
}
