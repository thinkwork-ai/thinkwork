variable "enabled" {
  description = "Create the AgentCore Harness trial IAM surface (THINK-311 U4). Pure-IAM and inert — nothing invokes Harness until U5 — so it defaults on; flip off to remove the role without touching root variables."
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
