################################################################################
# Thinkwork Composite Root — Outputs
################################################################################

# Foundation
output "vpc_id" {
  value = module.vpc.vpc_id
}

output "user_pool_id" {
  value = module.cognito.user_pool_id
}

output "admin_client_id" {
  value = module.cognito.admin_client_id
}

output "mobile_client_id" {
  value = module.cognito.mobile_client_id
}

output "identity_pool_id" {
  value = module.cognito.identity_pool_id
}

output "kms_key_arn" {
  value = module.kms.key_arn
}

# Data
output "db_cluster_arn" {
  value = module.database.db_cluster_arn
}

output "db_cluster_endpoint" {
  value = module.database.cluster_endpoint
}

output "db_secret_arn" {
  description = "Secrets Manager ARN for database credentials"
  value       = module.database.graphql_db_secret_arn
}

output "database_name" {
  description = "Database name"
  value       = var.database_name
}

output "bucket_name" {
  value = module.s3.bucket_name
}

output "kb_service_role_arn" {
  value = module.bedrock_kb.kb_service_role_arn
}

# App
output "api_endpoint" {
  value = module.api.api_endpoint
}

output "appsync_api_url" {
  value = module.appsync.graphql_api_url
}

output "appsync_realtime_url" {
  value = module.appsync.graphql_realtime_url
}

output "appsync_api_key" {
  value     = module.appsync.graphql_api_key
  sensitive = true
}

output "auth_domain" {
  description = "Cognito hosted UI domain"
  value       = module.cognito.auth_domain
}

output "ecr_repository_url" {
  value = module.agentcore.ecr_repository_url
}

output "agentcore_memory_id" {
  description = "Bedrock AgentCore Memory resource ID (always present — managed memory is always on)"
  value       = module.agentcore_memory.memory_id
}

output "hindsight_enabled" {
  description = "Whether the Hindsight add-on is enabled"
  value       = local.hindsight_enabled
}

output "hindsight_endpoint" {
  description = "Hindsight API endpoint (null when enable_hindsight = false)"
  value       = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : null
}

# Admin static site
output "admin_distribution_id" {
  description = "CloudFront distribution ID for the admin app"
  value       = module.admin_site.distribution_id
}

output "admin_distribution_domain" {
  description = "CloudFront domain for the admin app"
  value       = module.admin_site.distribution_domain
}

output "admin_bucket_name" {
  description = "S3 bucket for admin app assets"
  value       = module.admin_site.bucket_name
}

# Docs static site
output "docs_distribution_id" {
  description = "CloudFront distribution ID for the docs site"
  value       = module.docs_site.distribution_id
}

output "docs_distribution_domain" {
  description = "CloudFront domain for the docs site"
  value       = module.docs_site.distribution_domain
}

output "docs_bucket_name" {
  description = "S3 bucket for docs site assets"
  value       = module.docs_site.bucket_name
}

# Public website (www)
output "www_distribution_id" {
  description = "CloudFront distribution ID for the public website"
  value       = module.www_site.distribution_id
}

output "www_distribution_domain" {
  description = "CloudFront domain for the public website"
  value       = module.www_site.distribution_domain
}

output "www_bucket_name" {
  description = "S3 bucket for the public website assets"
  value       = module.www_site.bucket_name
}
