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
  description = "Target group ARN for the Plane web service"
  value       = aws_lb_target_group.web.arn
}

output "plane_cluster_arn" {
  description = "ECS cluster ARN for Plane"
  value       = aws_ecs_cluster.main.arn
}

output "plane_web_service_name" {
  description = "ECS service name for the Plane web service"
  value       = aws_ecs_service.service["web"].name
}

output "plane_api_service_name" {
  description = "ECS service name for the Plane API service"
  value       = aws_ecs_service.service["api"].name
}

output "plane_worker_service_name" {
  description = "ECS service name for the Plane worker"
  value       = aws_ecs_service.service["worker"].name
}

output "plane_beat_worker_service_name" {
  description = "ECS service name for the Plane beat worker"
  value       = aws_ecs_service.service["beat_worker"].name
}

output "plane_live_service_name" {
  description = "ECS service name for the Plane live service"
  value       = aws_ecs_service.service["live"].name
}

output "plane_web_log_group_name" {
  description = "CloudWatch log group for the Plane web service"
  value       = aws_cloudwatch_log_group.service["web"].name
}

output "plane_api_log_group_name" {
  description = "CloudWatch log group for the Plane API service"
  value       = aws_cloudwatch_log_group.service["api"].name
}

output "plane_worker_log_group_name" {
  description = "CloudWatch log group for the Plane worker"
  value       = aws_cloudwatch_log_group.service["worker"].name
}

output "plane_beat_worker_log_group_name" {
  description = "CloudWatch log group for the Plane beat worker"
  value       = aws_cloudwatch_log_group.service["beat_worker"].name
}

output "plane_live_log_group_name" {
  description = "CloudWatch log group for the Plane live service"
  value       = aws_cloudwatch_log_group.service["live"].name
}

output "plane_security_group_id" {
  description = "Security group ID for the Plane ECS tasks"
  value       = aws_security_group.plane.id
}

output "plane_cache_replication_group_id" {
  description = "ElastiCache replication group ID for Plane"
  value       = aws_elasticache_replication_group.plane.id
}

output "plane_cache_endpoint" {
  description = "ElastiCache primary endpoint for Plane"
  value       = aws_elasticache_replication_group.plane.primary_endpoint_address
}

output "plane_rabbitmq_broker_arn" {
  description = "Amazon MQ RabbitMQ broker ARN for Plane"
  value       = aws_mq_broker.rabbitmq.arn
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
  description = "Secrets Manager ARN used for the Plane AMQP_URL"
  value       = local.effective_amqp_url_secret_arn
}
