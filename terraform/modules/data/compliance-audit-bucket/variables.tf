################################################################################
# Compliance Audit Bucket — Variables
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "bucket_name" {
  description = "Name of the compliance audit-anchor S3 bucket (master-plan canonical: thinkwork-{stage}-compliance-anchors)"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the customer-managed KMS key used for SSE-KMS encryption of anchor objects. Must be non-empty - wired from module.kms.key_arn at the composite root."
  type        = string

  validation {
    condition     = length(var.kms_key_arn) > 0
    error_message = "kms_key_arn must be non-empty. Check that module.kms is enabled in the composite root (var.create_kms_key = true)."
  }
}

variable "mode" {
  description = "S3 Object Lock retention mode. GOVERNANCE allows a privileged role with s3:BypassGovernanceRetention to delete or shorten retention; COMPLIANCE is irreversible (even AWS root cannot delete or shorten until retention expires). Default GOVERNANCE per master plan Decision #2; flip to COMPLIANCE in prod via tfvars at audit-engagement time."
  type        = string
  default     = "GOVERNANCE"

  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.mode)
    error_message = "mode must be either GOVERNANCE or COMPLIANCE."
  }
}

variable "retention_days" {
  description = "Default Object Lock retention in days, applied to every PutObject under the anchors/ prefix unless an explicit per-object retention overrides it. SOC2 Type 1 baseline is 12 months (365)."
  type        = number
  default     = 365

  validation {
    condition     = var.retention_days > 0
    error_message = "retention_days must be greater than 0."
  }
}
