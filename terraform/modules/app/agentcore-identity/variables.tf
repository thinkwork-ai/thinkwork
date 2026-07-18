variable "enabled" {
  description = "Reconcile the non-production THINK-316 Identity proof resources."
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
  description = "AWS account id used to scope the external OAuth client-secret policy."
  type        = string
}

variable "oauth_issuer" {
  description = "Synthetic provider issuer URL exposed through the owned HTTP API."
  type        = string
}

variable "oauth_client_id" {
  description = "Synthetic OAuth client id."
  type        = string
}

variable "oauth_client_secret" {
  description = "Synthetic OAuth client secret; passed to the reconciler through its environment only."
  type        = string
  sensitive   = true
}

variable "user_federation_return_urls" {
  description = "Exact ThinkWork callbacks AgentCore may redirect to after user-federation authorization."
  type        = list(string)
  default     = []
}

variable "twenty_oauth_issuer" {
  description = "Twenty OAuth authorization-server issuer."
  type        = string
  default     = "https://crm.thinkwork.ai"
}

variable "twenty_oauth_resource" {
  description = "RFC 8707 resource identifier requested for the Twenty MCP server."
  type        = string
  default     = "https://crm.thinkwork.ai/mcp"
}
