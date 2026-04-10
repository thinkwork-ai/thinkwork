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
