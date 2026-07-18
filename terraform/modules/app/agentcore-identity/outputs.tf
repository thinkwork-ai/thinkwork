output "workload_identity_name" {
  description = "Name used for GetWorkloadAccessTokenForJWT. Empty when disabled."
  value       = var.enabled ? local.workload_identity_name : ""
}

output "credential_provider_name" {
  description = "AgentCore Identity OAuth2 credential-provider name. Empty when disabled."
  value       = var.enabled ? local.credential_provider_name : ""
}

output "oauth_return_url" {
  description = "Allowed user-federation return URL. Empty when disabled."
  value       = var.enabled ? local.oauth_return_url : ""
}

output "workload_identity_arn" {
  description = "Service-generated workload identity ARN. Empty when disabled."
  value       = var.enabled ? data.external.identity_state[0].result.workload_identity_arn : ""
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
