output "n8n_provisioned" {
  description = "Whether the retained n8n substrate is provisioned."
  value       = true
}

output "n8n_url" {
  description = "Public n8n URL."
  value       = var.public_url
}

output "n8n_alb_dns_name" {
  description = "Public ALB DNS name for n8n."
  value       = aws_lb.n8n.dns_name
}

output "n8n_alb_arn" {
  description = "Public ALB ARN for n8n."
  value       = aws_lb.n8n.arn
}

output "n8n_target_group_arn" {
  description = "Target group ARN for the n8n main service."
  value       = aws_lb_target_group.n8n.arn
}

output "n8n_cluster_arn" {
  description = "ECS cluster ARN for n8n."
  value       = aws_ecs_cluster.main.arn
}

output "n8n_main_service_name" {
  description = "ECS service name for the n8n main service."
  value       = aws_ecs_service.main.name
}

output "n8n_worker_service_name" {
  description = "ECS service name for the n8n worker service."
  value       = aws_ecs_service.worker.name
}

output "n8n_main_log_group_name" {
  description = "CloudWatch log group for the n8n main service."
  value       = aws_cloudwatch_log_group.main.name
}

output "n8n_worker_log_group_name" {
  description = "CloudWatch log group for the n8n worker service."
  value       = aws_cloudwatch_log_group.worker.name
}

output "n8n_security_group_id" {
  description = "Security group ID for the n8n ECS tasks."
  value       = aws_security_group.n8n.id
}

output "n8n_database_name" {
  description = "Dedicated PostgreSQL database name for n8n."
  value       = var.database_name
}

output "n8n_database_secret_arn" {
  description = "Secrets Manager ARN used for n8n database runtime credentials."
  value       = local.effective_database_url_secret_arn
}

output "n8n_database_admin_secret_arn" {
  description = "Secrets Manager ARN used by the managed-app setup step for database lifecycle operations."
  value       = var.database_admin_secret_arn
}

output "n8n_encryption_key_secret_arn" {
  description = "Secrets Manager ARN used for N8N_ENCRYPTION_KEY."
  value       = local.effective_encryption_key_secret_arn
}

output "n8n_operator_secret_arn" {
  description = "Secrets Manager ARN used for the shared native n8n operator account."
  value       = local.effective_operator_secret_arn
}

output "n8n_service_credential_secret_arn" {
  description = "Secrets Manager ARN used for the n8n MCP tenant service credential."
  value       = local.effective_service_credential_secret_arn
}

output "n8n_agent_step_bridge_credential_secret_arn" {
  description = "Secrets Manager ARN used for the inbound n8n agent-step bridge credential."
  value       = local.effective_agent_step_bridge_credential_secret_arn
}

output "n8n_valkey_replication_group_id" {
  description = "ElastiCache replication group ID for the n8n queue."
  value       = aws_elasticache_replication_group.n8n.id
}

output "n8n_valkey_endpoint" {
  description = "ElastiCache primary endpoint for the n8n queue."
  value       = aws_elasticache_replication_group.n8n.primary_endpoint_address
}

output "n8n_storage_bucket_name" {
  description = "S3 bucket name used for n8n managed artifacts and optional storage mode objects."
  value       = var.storage_bucket_name
}

output "n8n_storage_prefix" {
  description = "S3 prefix reserved for n8n managed artifacts."
  value       = local.storage_prefix
}

output "n8n_runtime_enabled" {
  description = "Whether the n8n main and worker services are configured to run."
  value       = var.runtime_enabled
}

output "n8n_image_digest" {
  description = "Immutable digest extracted from the n8n wrapper image URI."
  value       = local.image_digest
}

output "n8n_package_config_digest" {
  description = "Digest of the reviewed n8n custom-package configuration."
  value       = var.package_config_digest
}
