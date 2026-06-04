output "cognee_endpoint" {
  description = "Internal Cognee API endpoint"
  value       = "http://${aws_lb.cognee.dns_name}"
}

output "cognee_log_group_name" {
  description = "CloudWatch log group for Cognee"
  value       = aws_cloudwatch_log_group.cognee.name
}

output "cognee_task_role_arn" {
  description = "IAM role assumed by the Cognee ECS task"
  value       = aws_iam_role.ecs_task.arn
}

output "cognee_execution_role_arn" {
  description = "IAM role used by ECS to pull the Cognee image and inject secrets"
  value       = aws_iam_role.ecs_execution.arn
}

output "cognee_backend_mode" {
  description = "Selected Cognee backend mode"
  value       = var.backend_mode
}

output "cognee_cluster_arn" {
  description = "ECS cluster ARN for the Cognee service"
  value       = aws_ecs_cluster.main.arn
}

output "cognee_service_name" {
  description = "ECS service name for Cognee"
  value       = aws_ecs_service.cognee.name
}

output "cognee_alb_arn" {
  description = "Internal ALB ARN for Cognee"
  value       = aws_lb.cognee.arn
}

output "cognee_security_group_id" {
  description = "Security group ID for the Cognee ECS task"
  value       = aws_security_group.cognee.id
}

output "cognee_storage_file_system_id" {
  description = "EFS file system ID backing Cognee writable data/system directories"
  value       = aws_efs_file_system.cognee.id
}

output "cognee_db_password_secret_arn" {
  description = "Secrets Manager ARN used for the Cognee DB password"
  value       = local.effective_db_password_secret_arn
}

output "cognee_llm_api_key_secret_arn" {
  description = "Secrets Manager ARN used for the optional Cognee LLM API key"
  value       = local.effective_llm_api_key_secret_arn
}

output "cognee_embedding_api_key_secret_arn" {
  description = "Secrets Manager ARN used for the optional Cognee embedding API key"
  value       = local.effective_embedding_api_key_secret_arn
}

output "cognee_vector_db_key_secret_arn" {
  description = "Secrets Manager ARN used for the optional Cognee vector store key"
  value       = local.effective_vector_db_key_secret_arn
}

output "cognee_graph_database_password_secret_arn" {
  description = "Secrets Manager ARN used for the optional Cognee graph store password"
  value       = local.effective_graph_database_password_secret_arn
}
