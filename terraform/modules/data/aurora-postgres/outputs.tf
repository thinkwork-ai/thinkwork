output "cluster_endpoint" {
  description = "Database endpoint (created or existing)"
  value       = local.cluster_endpoint
}

output "db_cluster_arn" {
  description = "Database ARN (created or existing)"
  value       = local.db_cluster_arn
}

output "graphql_db_secret_arn" {
  description = "Secrets Manager ARN for DB credentials (created or existing)"
  value       = local.graphql_db_secret_arn
}

output "db_security_group_id" {
  description = "Security group ID for the database (created or existing)"
  value       = local.db_security_group_id
}

output "database_url" {
  description = "PostgreSQL connection string (only available when create_database = true)"
  value       = local.create ? "postgresql://${local.master_username}:${var.db_password}@${local.cluster_endpoint}:5432/${var.database_name}" : null
  sensitive   = true
}

output "database_engine" {
  description = "Which engine is running (aurora-serverless or rds-postgres)"
  value       = var.database_engine
}

output "aws_s3_iam_role_arn" {
  description = "ARN of the IAM role attached to the Aurora cluster for `aws_s3.query_export_to_s3` (only when backups_bucket_arn is set). Null otherwise. Useful for confirming the role attachment in post-deploy runbooks."
  value       = local.enable_aws_s3 ? aws_iam_role.aurora_aws_s3[0].arn : null
}

# ----------------------------------------------------------------------------
# Compliance role secret ARNs (Phase 3 U2)
#
# Container-only — Terraform creates the AWS Secrets Manager resource;
# secret values are populated by scripts/bootstrap-compliance-roles.sh
# alongside the matching Aurora roles in
# drizzle/0070_compliance_aurora_roles.sql.
#
# Consumers:
#   compliance_writer_secret_arn  → U3 emitAuditEvent helper (resolver path)
#   compliance_drainer_secret_arn → U4 outbox drainer Lambda
#   compliance_reader_secret_arn  → U10 graphql-http Compliance read path
# ----------------------------------------------------------------------------

output "compliance_writer_secret_arn" {
  description = "Secrets Manager ARN for the compliance_writer Aurora role (Phase 3 U2). Empty string when create_database = false."
  value       = local.create ? aws_secretsmanager_secret.compliance_writer[0].arn : ""
}

output "compliance_drainer_secret_arn" {
  description = "Secrets Manager ARN for the compliance_drainer Aurora role (Phase 3 U2). Empty string when create_database = false."
  value       = local.create ? aws_secretsmanager_secret.compliance_drainer[0].arn : ""
}

output "compliance_reader_secret_arn" {
  description = "Secrets Manager ARN for the compliance_reader Aurora role (Phase 3 U2). Empty string when create_database = false."
  value       = local.create ? aws_secretsmanager_secret.compliance_reader[0].arn : ""
}
