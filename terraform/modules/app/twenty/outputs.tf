output "twenty_url" {
  description = "Public Twenty CRM URL"
  value       = var.public_url
}

output "twenty_alb_dns_name" {
  description = "Public ALB DNS name for Twenty"
  value       = aws_lb.twenty.dns_name
}

output "twenty_alb_arn" {
  description = "Public ALB ARN for Twenty"
  value       = aws_lb.twenty.arn
}

output "twenty_target_group_arn" {
  description = "Target group ARN for the Twenty server"
  value       = aws_lb_target_group.twenty.arn
}

output "twenty_cluster_arn" {
  description = "ECS cluster ARN for Twenty"
  value       = aws_ecs_cluster.main.arn
}

output "twenty_server_service_name" {
  description = "ECS service name for the Twenty server"
  value       = aws_ecs_service.server.name
}

output "twenty_worker_service_name" {
  description = "ECS service name for the Twenty worker"
  value       = aws_ecs_service.worker.name
}

output "twenty_server_log_group_name" {
  description = "CloudWatch log group for the Twenty server"
  value       = aws_cloudwatch_log_group.server.name
}

output "twenty_worker_log_group_name" {
  description = "CloudWatch log group for the Twenty worker"
  value       = aws_cloudwatch_log_group.worker.name
}

output "twenty_security_group_id" {
  description = "Security group ID for the Twenty ECS tasks"
  value       = aws_security_group.twenty.id
}

output "twenty_storage_file_system_id" {
  description = "EFS file system ID backing Twenty local storage"
  value       = aws_efs_file_system.twenty.id
}

output "twenty_cache_replication_group_id" {
  description = "ElastiCache replication group ID for Twenty"
  value       = aws_elasticache_replication_group.twenty.id
}

output "twenty_cache_endpoint" {
  description = "ElastiCache primary endpoint for Twenty"
  value       = aws_elasticache_replication_group.twenty.primary_endpoint_address
}

output "twenty_runtime_enabled" {
  description = "Whether the Twenty server and worker are configured to run"
  value       = var.runtime_enabled
}

output "twenty_db_url_secret_arn" {
  description = "Secrets Manager ARN used for the Twenty PG_DATABASE_URL"
  value       = local.effective_db_url_secret_arn
}

output "twenty_encryption_key_secret_arn" {
  description = "Secrets Manager ARN used for the Twenty ENCRYPTION_KEY"
  value       = local.effective_encryption_key_secret_arn
}
