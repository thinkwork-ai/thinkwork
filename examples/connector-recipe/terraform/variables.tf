variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "thinkwork_api_url" {
  description = "Thinkwork API base URL (e.g. https://api.thinkwork.ai)"
  type        = string
}

variable "thinkwork_api_key" {
  description = "Thinkwork API key for authenticating inbound message requests"
  type        = string
  sensitive   = true
}

variable "webhook_signing_secret" {
  description = "Secret used to verify incoming webhook signatures (HMAC-SHA256)"
  type        = string
  sensitive   = true
}

variable "connector_id" {
  description = "Unique identifier for this connector (e.g. my-slack-connector)"
  type        = string
  default     = "my-connector"
}

variable "target_computer_id" {
  description = "ThinkWork Computer ID that should own inbound connector work"
  type        = string
}
