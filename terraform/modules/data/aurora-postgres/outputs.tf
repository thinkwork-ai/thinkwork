output "cluster_endpoint" {
  description = "Aurora cluster writer endpoint"
  value       = local.cluster_endpoint
}

output "db_cluster_arn" {
  description = "Aurora cluster ARN (created or existing)"
  value       = local.db_cluster_arn
}

output "graphql_db_secret_arn" {
  description = "Secrets Manager ARN for DB credentials (created or existing)"
  value       = local.graphql_db_secret_arn
}

output "db_security_group_id" {
  description = "Security group ID for the Aurora cluster (created or existing)"
  value       = local.db_security_group_id
}

output "database_url" {
  description = "PostgreSQL connection string (only available when create_database = true)"
  value       = local.create ? "postgresql://${local.master_username}:${var.db_password}@${aws_rds_cluster.main[0].endpoint}:5432/${var.database_name}" : null
  sensitive   = true
}
