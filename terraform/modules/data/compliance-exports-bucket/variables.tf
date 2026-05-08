################################################################################
# Compliance Exports Bucket — Variables
################################################################################

variable "stage" {
  description = "Deployment stage."
  type        = string
}

variable "account_id" {
  description = "AWS account ID. Pinned in the runner Lambda's trust policy as aws:SourceAccount for confused-deputy defense."
  type        = string
}

variable "region" {
  description = "AWS region. Used in the runner Lambda's trust-policy aws:SourceArn pin to constrain AssumeRole to the predictable function ARN `arn:aws:lambda:{region}:{account_id}:function:thinkwork-{stage}-api-compliance-export-runner`."
  type        = string

  validation {
    condition     = length(var.region) > 0 && var.region == trimspace(var.region)
    error_message = "region must be non-empty and free of leading/trailing whitespace."
  }
}

variable "bucket_name" {
  description = "Name of the compliance exports S3 bucket. Canonical pattern: `thinkwork-{stage}-compliance-exports`."
  type        = string

  validation {
    condition     = length(var.bucket_name) > 0
    error_message = "bucket_name must be non-empty."
  }
}

variable "expiration_days" {
  description = "Number of days an export object lives before lifecycle expiration. SOC2 walkthrough auditors typically download artifacts within hours; 7 days is the audit-window default."
  type        = number
  default     = 7

  validation {
    condition     = var.expiration_days >= 1 && var.expiration_days <= 90
    error_message = "expiration_days must be between 1 and 90 inclusive."
  }
}
