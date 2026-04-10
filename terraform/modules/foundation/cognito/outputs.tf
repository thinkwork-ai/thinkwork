output "user_pool_id" {
  description = "Cognito user pool ID (created or existing)"
  value       = local.user_pool_id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN (created or existing)"
  value       = local.user_pool_arn
}

output "hive_client_id" {
  description = "App client ID for the web admin client (created or existing)"
  value       = local.hive_client_id
}

output "hive_app_client_id" {
  description = "App client ID for the mobile client (created or existing)"
  value       = local.hive_app_client_id
}

output "identity_pool_id" {
  description = "Identity pool ID (created or existing)"
  value       = local.identity_pool_id
}

output "auth_domain" {
  description = "Cognito hosted UI domain (only available when create_cognito = true)"
  value       = local.create ? aws_cognito_user_pool_domain.main[0].domain : null
}
