output "kestra_url" {
  description = "Public Kestra URL"
  value       = var.public_url
}

output "kestra_alb_dns_name" {
  description = "Public ALB DNS name for Kestra"
  value       = aws_lb.kestra.dns_name
}

output "kestra_alb_arn" {
  description = "Public ALB ARN for Kestra"
  value       = aws_lb.kestra.arn
}

output "kestra_target_group_arn" {
  description = "Target group ARN for Kestra"
  value       = aws_lb_target_group.kestra.arn
}

output "kestra_cluster_arn" {
  description = "ECS cluster ARN for Kestra"
  value       = aws_ecs_cluster.main.arn
}

output "kestra_service_name" {
  description = "ECS service name for Kestra"
  value       = aws_ecs_service.kestra.name
}

output "kestra_log_group_name" {
  description = "CloudWatch log group for Kestra"
  value       = aws_cloudwatch_log_group.kestra.name
}

output "kestra_security_group_id" {
  description = "Security group ID for the Kestra ECS task"
  value       = aws_security_group.kestra.id
}

output "kestra_storage_bucket_name" {
  description = "S3 bucket name backing Kestra internal storage"
  value       = aws_s3_bucket.kestra.bucket
}

output "kestra_storage_bucket_arn" {
  description = "S3 bucket ARN backing Kestra internal storage"
  value       = aws_s3_bucket.kestra.arn
}

output "kestra_storage_file_system_id" {
  description = "Reserved for future EFS-backed Kestra storage modes. Null for the v1 S3 storage module."
  value       = null
}

output "kestra_runtime_enabled" {
  description = "Whether the Kestra ECS service is configured to run"
  value       = var.runtime_enabled
}

output "kestra_database_name" {
  description = "Dedicated PostgreSQL database name used by Kestra"
  value       = var.db_name
}

output "kestra_db_password_secret_arn" {
  description = "Secrets Manager ARN used for the Kestra PostgreSQL password"
  value       = local.effective_db_password_secret_arn
}

output "kestra_basic_auth_secret_arn" {
  description = "Secrets Manager ARN used for the Kestra UI/API basic-auth service credential"
  value       = local.effective_basic_auth_secret_arn
}

output "kestra_task_role_arn" {
  description = "IAM role assumed by the Kestra ECS task"
  value       = aws_iam_role.ecs_task.arn
}

output "kestra_execution_role_arn" {
  description = "IAM role used by ECS to pull the Kestra image and inject secrets"
  value       = aws_iam_role.ecs_execution.arn
}
