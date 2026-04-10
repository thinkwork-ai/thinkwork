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

output "ecr_repository_url" {
  value = module.agentcore.ecr_repository_url
}
