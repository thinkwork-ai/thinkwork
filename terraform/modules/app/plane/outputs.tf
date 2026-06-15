output "plane_url" {
  description = "Public Plane URL"
  value       = var.public_url
}

output "plane_alb_dns_name" {
  description = "Public ALB DNS name for Plane"
  value       = aws_lb.plane.dns_name
}

output "plane_alb_arn" {
  description = "Public ALB ARN for Plane"
  value       = aws_lb.plane.arn
}

output "plane_target_group_arn" {
  description = "Target group ARN for the compact Plane app service"
  value       = aws_lb_target_group.service["app"].arn
}

output "plane_cluster_arn" {
  description = "ECS cluster ARN for Plane"
  value       = aws_ecs_cluster.main.arn
}

output "plane_web_service_name" {
  description = "ECS service name for the compact Plane service"
  value       = aws_ecs_service.plane.name
}

output "plane_api_service_name" {
  description = "Compatibility alias for the compact Plane service"
  value       = aws_ecs_service.plane.name
}

output "plane_worker_service_name" {
  description = "Compatibility alias for the compact Plane service"
  value       = aws_ecs_service.plane.name
}

output "plane_beat_worker_service_name" {
  description = "Compatibility alias for the compact Plane service"
  value       = aws_ecs_service.plane.name
}

output "plane_live_service_name" {
  description = "Compatibility alias for the compact Plane service"
  value       = aws_ecs_service.plane.name
}

output "plane_mcp_service_name" {
  description = "Compatibility alias for the compact Plane service hosting the MCP sidecar"
  value       = aws_ecs_service.plane.name
}

output "plane_web_log_group_name" {
  description = "CloudWatch log group for the Plane AIO container"
  value       = aws_cloudwatch_log_group.service["app"].name
}

output "plane_api_log_group_name" {
  description = "Compatibility alias for the Plane AIO container log group"
  value       = aws_cloudwatch_log_group.service["app"].name
}

output "plane_worker_log_group_name" {
  description = "Compatibility alias for the Plane AIO container log group"
  value       = aws_cloudwatch_log_group.service["app"].name
}

output "plane_beat_worker_log_group_name" {
  description = "Compatibility alias for the Plane AIO container log group"
  value       = aws_cloudwatch_log_group.service["app"].name
}

output "plane_live_log_group_name" {
  description = "Compatibility alias for the Plane AIO container log group"
  value       = aws_cloudwatch_log_group.service["app"].name
}

output "plane_mcp_log_group_name" {
  description = "CloudWatch log group for the Plane MCP sidecar"
  value       = aws_cloudwatch_log_group.service["mcp"].name
}

output "plane_security_group_id" {
  description = "Security group ID for the Plane ECS tasks"
  value       = aws_security_group.plane.id
}

output "plane_cache_replication_group_id" {
  description = "Deprecated compatibility output. Compact Plane AIO does not provision a separate cache."
  value       = null
}

output "plane_cache_endpoint" {
  description = "Deprecated compatibility output. Compact Plane AIO does not provision a separate cache."
  value       = null
}

output "plane_rabbitmq_broker_arn" {
  description = "Deprecated compatibility output. Compact Plane AIO does not provision RabbitMQ/Amazon MQ."
  value       = null
}

output "plane_storage_bucket_name" {
  description = "S3 bucket name used for Plane file uploads"
  value       = var.s3_bucket_name
}

output "plane_runtime_enabled" {
  description = "Whether Plane services are configured to run"
  value       = var.runtime_enabled
}

output "plane_db_url_secret_arn" {
  description = "Secrets Manager ARN used for the Plane DATABASE_URL"
  value       = local.effective_db_url_secret_arn
}

output "plane_secret_key_secret_arn" {
  description = "Secrets Manager ARN used for the Plane SECRET_KEY"
  value       = local.effective_secret_key_secret_arn
}

output "plane_live_server_secret_key_secret_arn" {
  description = "Secrets Manager ARN used for the Plane LIVE_SERVER_SECRET_KEY"
  value       = local.effective_live_server_secret_key_secret_arn
}

output "plane_aes_secret_key_secret_arn" {
  description = "Secrets Manager ARN used for the Plane AES_SECRET_KEY"
  value       = local.effective_aes_secret_key_secret_arn
}

output "plane_amqp_url_secret_arn" {
  description = "Deprecated compatibility output. Compact Plane AIO does not inject AMQP_URL."
  value       = null
}
