variable "stage" {
  description = "Deployment stage (for example dev or prod)."
  type        = string
}

variable "account_id" {
  description = "AWS account ID that owns the deployment control plane."
  type        = string
}

variable "region" {
  description = "AWS region for control-plane resources."
  type        = string
}

variable "release_version" {
  description = "Selected ThinkWork release version."
  type        = string
}

variable "release_manifest_url" {
  description = "Selected ThinkWork release manifest URL."
  type        = string
}

variable "release_manifest_sha256" {
  description = "Selected ThinkWork release manifest SHA-256 digest."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention for deployment runner logs."
  type        = number
  default     = 30
}

variable "create_secret_placeholders" {
  description = "Create placeholder Secrets Manager values for bootstrap-managed deployment secrets. Values are ignored after creation."
  type        = bool
  default     = true
}

