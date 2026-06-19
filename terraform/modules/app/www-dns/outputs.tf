output "certificate_arn" {
  description = "ACM certificate ARN (us-east-1) covering apex + www. Pass this to the static-site module via www_certificate_arn."
  value       = aws_acm_certificate_validation.www.certificate_arn
}

output "www_redirect_distribution_id" {
  description = "CloudFront distribution ID for the www→apex redirect"
  value       = aws_cloudfront_distribution.www_redirect.id
}

output "www_redirect_distribution_domain" {
  description = "CloudFront distribution domain for the www→apex redirect"
  value       = aws_cloudfront_distribution.www_redirect.domain_name
}

output "api_custom_domain_name" {
  description = "Custom domain name for the HTTP API (e.g. api.thinkwork.ai). Empty string when include_api is false."
  value       = var.include_api ? aws_apigatewayv2_domain_name.api[0].domain_name : ""
}

output "api_custom_domain_target" {
  description = "API Gateway regional target domain to CNAME to (useful for external DNS configuration). Empty string when include_api is false."
  value       = var.include_api ? aws_apigatewayv2_domain_name.api[0].domain_name_configuration[0].target_domain_name : ""
}

output "crm_custom_domain_name" {
  description = "Custom domain name for Twenty CRM (e.g. crm.thinkwork.ai). Empty string when include_crm is false."
  value       = var.include_crm ? "crm.${var.domain}" : ""
}

output "n8n_custom_domain_name" {
  description = "Custom domain name for n8n (e.g. n8n.thinkwork.ai). Empty string when include_n8n is false."
  value       = var.include_n8n ? "n8n.${var.domain}" : ""
}
