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
