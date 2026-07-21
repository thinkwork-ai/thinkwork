output "workload_identity_name" {
  description = "Name used for GetWorkloadAccessTokenForJWT. Empty when disabled."
  value       = local.identity_enabled ? local.workload_identity_name : ""
}

output "credential_provider_name" {
  description = "AgentCore Identity OAuth2 credential-provider name. Empty when disabled."
  value       = var.enabled ? local.credential_provider_name : ""
}

output "oauth_return_url" {
  description = "Allowed user-federation return URL. Empty when disabled."
  value       = var.enabled ? local.oauth_return_url : ""
}

output "twenty_credential_provider_name" {
  description = "AgentCore Identity provider name for per-user Twenty grants."
  value       = var.twenty_enabled ? local.twenty_credential_provider_name : ""
}

output "twenty_credential_provider_arn" {
  description = "AgentCore Identity provider ARN for per-user Twenty grants."
  value       = var.twenty_enabled ? data.external.identity_state[0].result.twenty_credential_provider_arn : ""
}

output "twenty_oauth_callback_url" {
  description = "Service-generated callback URL registered with Twenty OAuth."
  value       = var.twenty_enabled ? data.external.identity_state[0].result.twenty_oauth_callback_url : ""
}

output "twenty_client_secret_arn" {
  description = "External Secrets Manager client record consumed by AgentCore Identity."
  value       = var.twenty_enabled ? aws_secretsmanager_secret.twenty_oauth_client[0].arn : ""
  sensitive   = true
}

output "workload_identity_arn" {
  description = "Service-generated workload identity ARN. Empty when disabled."
  value       = local.identity_enabled ? data.external.identity_state[0].result.workload_identity_arn : ""
}

output "credential_provider_arn" {
  description = "Service-generated OAuth2 credential-provider ARN. Empty when disabled."
  value       = var.enabled ? data.external.identity_state[0].result.credential_provider_arn : ""
}

output "credential_secret_arn" {
  description = "AgentCore-managed Secrets Manager ARN backing the provider. Empty when disabled."
  value       = var.enabled ? data.external.identity_state[0].result.credential_secret_arn : ""
  sensitive   = true
}
