################################################################################
# Compliance Exports Bucket — Outputs
################################################################################

output "bucket_name" {
  description = "Name (id) of the compliance exports S3 bucket."
  value       = aws_s3_bucket.exports.id
}

output "bucket_arn" {
  description = "ARN of the compliance exports S3 bucket."
  value       = aws_s3_bucket.exports.arn
}

output "runner_role_arn" {
  description = "ARN of the IAM role the U11 export runner Lambda assumes. Inert in U11.U2 — the function exists with a stub body until U11.U3."
  value       = aws_iam_role.runner_lambda.arn
}

output "runner_role_name" {
  description = "Name of the IAM role the runner Lambda assumes. Used by sibling app-tier modules that need to attach inline policies (e.g., DLQ SendMessage, SQS receive) to this role without re-deriving the name from the ARN."
  value       = aws_iam_role.runner_lambda.name
}
