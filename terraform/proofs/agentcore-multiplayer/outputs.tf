output "api_endpoint" {
  value = aws_apigatewayv2_api.proof.api_endpoint
}

output "assertion_issuer" {
  value = local.assertion_issuer
}

output "assertion_kms_key_arn" {
  value = aws_kms_key.assertion.arn
}

output "assertion_kid" {
  value = local.assertion_kid
}

output "harness_audience" {
  value = local.harness_audience
}

output "gateway_audience" {
  value = local.gateway_audience
}

output "gateway_url" {
  value = module.gateway.gateway_url
}

output "gateway_arn" {
  value = module.gateway.gateway_arn
}

output "gateway_target_name" {
  value = module.gateway.target_name
}

output "oauth_provider_name" {
  value = module.identity.credential_provider_name
}

output "manual_workload_identity_name" {
  value = module.identity.workload_identity_name
}

output "oauth_return_url" {
  value = module.identity.oauth_return_url
}
