################################################################################
# KMS — Foundation Module
#
# Creates KMS keys for encryption at rest, or accepts existing key ARNs.
# v1: single key for general-purpose encryption (Aurora, S3, SSM, logs).
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "create_kms_key" {
  description = "Whether to create a new KMS key. Set to false to use an existing key."
  type        = bool
  default     = true
}

variable "existing_kms_key_arn" {
  description = "ARN of an existing KMS key (required when create_kms_key = false)"
  type        = string
  default     = null
}

resource "aws_kms_key" "main" {
  count               = var.create_kms_key ? 1 : 0
  description         = "Thinkwork ${var.stage} general-purpose encryption key"
  enable_key_rotation = true

  tags = {
    Name = "thinkwork-${var.stage}-main"
  }
}

resource "aws_kms_alias" "main" {
  count         = var.create_kms_key ? 1 : 0
  name          = "alias/thinkwork-${var.stage}"
  target_key_id = aws_kms_key.main[0].key_id
}

output "key_arn" {
  description = "KMS key ARN (created or existing)"
  value       = var.create_kms_key ? aws_kms_key.main[0].arn : var.existing_kms_key_arn
}

output "key_id" {
  description = "KMS key ID (only available when create_kms_key = true)"
  value       = var.create_kms_key ? aws_kms_key.main[0].key_id : null
}
