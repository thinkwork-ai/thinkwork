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
