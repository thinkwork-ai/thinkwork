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
