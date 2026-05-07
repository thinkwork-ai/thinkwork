################################################################################
# Compliance Audit Bucket — Outputs
################################################################################

output "bucket_name" {
  description = "Name (id) of the compliance audit-anchor S3 bucket."
  value       = aws_s3_bucket.anchor.id
}

output "bucket_arn" {
  description = "ARN of the compliance audit-anchor S3 bucket."
  value       = aws_s3_bucket.anchor.arn
}

output "lambda_role_arn" {
  description = "ARN of the IAM role the anchor Lambda (U8a/U8b) will assume. Inert in U7 — no Lambda function references this yet."
  value       = aws_iam_role.anchor_lambda.arn
}

output "lambda_role_name" {
  description = "Name of the IAM role the anchor Lambda assumes. Used by sibling app-tier modules that need to attach inline policies (e.g., DLQ SendMessage) to this role without re-deriving the name from the ARN."
  value       = aws_iam_role.anchor_lambda.name
}

output "watchdog_role_arn" {
  description = "ARN of the sibling IAM role the watchdog Lambda assumes (Phase 3 U8b). Decrypt-less: kms:DescribeKey only on the bucket CMK; s3:ListBucket prefix-scoped to anchors/."
  value       = aws_iam_role.anchor_watchdog_lambda.arn
}

output "watchdog_role_name" {
  description = "Name of the sibling watchdog IAM role. Used by app-tier modules that may need to attach future inline policies (e.g., DLQ SendMessage) without re-deriving the name from the ARN."
  value       = aws_iam_role.anchor_watchdog_lambda.name
}

output "kms_key_arn" {
  description = "Pass-through of var.kms_key_arn so app-tier modules can wire the CMK ARN into the anchor Lambda's COMPLIANCE_ANCHOR_KMS_KEY_ARN env var without taking a second dependency on module.kms."
  value       = var.kms_key_arn
}

output "object_lock_mode" {
  description = "Pass-through of var.mode so app-tier modules can wire the Object Lock mode into the anchor Lambda's COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE env var. Whatever the bucket is locked to is what the per-object writes assert."
  value       = var.mode
}
