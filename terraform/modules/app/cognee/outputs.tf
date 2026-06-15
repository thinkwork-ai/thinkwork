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

output "cognee_brain_instance_key" {
  description = "Tenant-scoped Company Brain instance key used for resource naming; null for legacy stage-wide instances."
  value       = local.tenant_scoped_brain_instance ? local.normalized_brain_instance_key : null
}

output "cognee_brain_tenant_id" {
  description = "Tenant ID owning this Company Brain substrate instance; null for legacy stage-wide instances."
  value       = var.brain_tenant_id != "" ? var.brain_tenant_id : null
}

output "cognee_brain_storage_tier" {
  description = "Company Brain storage tier selected for this substrate instance."
  value       = var.brain_storage_tier
}

output "cognee_graph_database_provider" {
  description = "Cognee graph database provider selected for the Brain substrate."
  value       = var.graph_database_provider
}

output "cognee_vector_db_provider" {
  description = "Cognee vector database provider selected for the Brain substrate."
  value       = var.vector_db_provider
}

output "cognee_embedding_model" {
  description = "Embedding model configured for Brain retrieval and migration evidence."
  value       = var.embedding_model
}

output "cognee_embedding_dimensions" {
  description = "Embedding vector dimension configured for Brain retrieval and migration evidence."
  value       = var.embedding_dimensions
}

output "cognee_s3_artifact_root" {
  description = "Canonical Company Brain S3 source artifact root."
  value       = var.brain_s3_artifact_root
}

output "cognee_s3_manifest_root" {
  description = "Canonical Company Brain S3 ingestion manifest root."
  value       = var.brain_s3_manifest_root
}

output "cognee_s3_vault_projection_root" {
  description = "Canonical Company Brain S3 vault projection root."
  value       = var.brain_s3_vault_projection_root
}

output "cognee_neptune_graph_id" {
  description = "Neptune Analytics graph ID for production Brain tier."
  value       = var.neptune_graph_id
}

output "cognee_neptune_endpoint" {
  description = "Neptune Analytics endpoint for production Brain tier."
  value       = var.neptune_endpoint
}

output "cognee_private_substrate_mode" {
  description = "Whether the Brain substrate is configured as private/internal-only."
  value       = var.private_substrate_mode
}

output "cognee_production_posture" {
  description = "Operator evidence string for production-tier approval/readiness posture."
  value       = var.production_posture
}

output "cognee_cluster_arn" {
  description = "Company Brain ECS cluster ARN hosting the Cognee service"
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
