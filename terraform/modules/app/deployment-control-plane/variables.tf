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

variable "release_manifest_signature_url" {
  description = "Optional selected ThinkWork release manifest detached signature URL."
  type        = string
  default     = ""
}

variable "release_manifest_trust_policy" {
  description = "Release manifest trust policy: allow_unsigned_canary for dogfood canaries, or require_signature for customer-safe runs."
  type        = string
  default     = "allow_unsigned_canary"

  validation {
    condition     = contains(["allow_unsigned_canary", "require_signature"], var.release_manifest_trust_policy)
    error_message = "release_manifest_trust_policy must be allow_unsigned_canary or require_signature."
  }
}

variable "release_manifest_trusted_keys_json" {
  description = "JSON array of trusted release signing keys: [{\"keyId\":\"...\",\"publicKeyPem\":\"...\"}]."
  type        = string
  default     = "[]"

  validation {
    condition     = can(jsondecode(var.release_manifest_trusted_keys_json))
    error_message = "release_manifest_trusted_keys_json must be valid JSON."
  }
}

variable "terraform_state_bucket" {
  description = "Customer-owned S3 bucket that stores the ThinkWork app Terraform state."
  type        = string
}

variable "terraform_lock_table" {
  description = "Customer-owned DynamoDB table used for Terraform state locking."
  type        = string
}

variable "release_artifact_bucket" {
  description = "Customer-owned S3 bucket where the runner stages release Lambda artifacts for Terraform."
  type        = string
}

variable "terraform_module_source" {
  description = "Terraform Registry source for the ThinkWork composite module."
  type        = string
  default     = "thinkwork-ai/thinkwork/aws"
}

variable "terraform_module_version" {
  description = "Terraform Registry module version to deploy. Defaults to release_version when empty."
  type        = string
  default     = ""
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
