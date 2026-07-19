output "user_pool_id" {
  description = "Cognito user pool ID (created or existing)"
  value       = local.user_pool_id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN (created or existing)"
  value       = local.user_pool_arn
}

output "admin_client_id" {
  description = "App client ID for the web admin client (created or existing)"
  value       = local.admin_client_id
}

output "mobile_client_id" {
  description = "App client ID for the mobile client (created or existing)"
  value       = local.mobile_client_id
}

output "identity_pool_id" {
  description = "Identity pool ID (created or existing)"
  value       = local.identity_pool_id
}

output "auth_domain" {
  description = "Cognito hosted UI domain (only available when create_cognito = true)"
  value       = local.create ? aws_cognito_user_pool_domain.main[0].domain : null
}

output "identity_provider_names" {
  description = "Supported Cognito identity providers for created app clients."
  value       = local.identity_providers
}

output "auth_route_clients" {
  description = "Safe app-client-to-route manifest. Contains no upstream provider secrets."
  value = local.create ? {
    for key, client in aws_cognito_user_pool_client.auth_route : key => {
      client_id           = client.id
      route_key           = local.auth_routes[key].route_key
      client_family       = local.auth_routes[key].client_family
      provider_names      = local.auth_routes[key].provider_names
      explicit_auth_flows = local.auth_routes[key].explicit_auth_flows
      callback_urls       = distinct(local.auth_routes[key].callback_urls)
      logout_urls         = distinct(local.auth_routes[key].logout_urls)
      lifecycle_state     = "native"
    }
  } : var.existing_auth_route_clients
}

output "auth_retirement_phase" {
  description = "Applied authentication retirement phase used for safe controller upgrades."
  value       = var.auth_retirement_phase
}

output "web_local_client_id" {
  description = "Local-password-only Cognito app client for the web client family."
  value = local.create ? aws_cognito_user_pool_client.auth_route["web:local"].id : try(
    var.existing_auth_route_clients["web:local"].client_id,
    null,
  )
}

output "mobile_local_client_id" {
  description = "Local-password-only Cognito app client for the mobile client family."
  value = local.create ? aws_cognito_user_pool_client.auth_route["mobile:local"].id : try(
    var.existing_auth_route_clients["mobile:local"].client_id,
    null,
  )
}

output "microsoft_identity_provider_name" {
  description = "Default tenant-specific Microsoft Cognito provider name, or null when not configured."
  value       = var.microsoft_oauth_client_id != "" ? "MicrosoftOrganizations" : null
}
