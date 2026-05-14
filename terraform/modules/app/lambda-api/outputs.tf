output "api_id" {
  description = "API Gateway V2 API ID"
  value       = aws_apigatewayv2_api.main.id
}

output "api_endpoint" {
  description = "API Gateway V2 endpoint URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_execution_arn" {
  description = "API Gateway V2 execution ARN (for Lambda permissions)"
  value       = aws_apigatewayv2_api.main.execution_arn
}

output "extension_proxy_route_prefix" {
  description = "Route prefix private Admin extensions call through for tenant-scoped backend proxying."
  value       = "/api/extensions"
}

output "lambda_role_arn" {
  description = "Shared Lambda execution role ARN (for other modules that add routes)"
  value       = aws_iam_role.lambda.arn
}

output "lambda_role_name" {
  description = "Shared Lambda execution role name"
  value       = aws_iam_role.lambda.name
}

output "memory_retain_fn_name" {
  description = "Memory-retain Lambda function name. Strands runtime invokes this directly to push conversational turns into the active memory engine."
  value       = local.use_local_zips ? aws_lambda_function.handler["memory-retain"].function_name : ""
}

output "memory_retain_fn_arn" {
  description = "Memory-retain Lambda ARN. Used to grant lambda:InvokeFunction to the agentcore-runtime role."
  value       = local.use_local_zips ? aws_lambda_function.handler["memory-retain"].arn : ""
}

output "email_inbound_fn_arn" {
  description = "email-inbound Lambda ARN. Used by the SES module to wire the receipt rule Lambda action."
  value       = local.use_local_zips ? aws_lambda_function.handler["email-inbound"].arn : ""
}

output "email_inbound_fn_name" {
  description = "email-inbound Lambda function name. Used by the SES module for lambda:InvokeFunction permissions."
  value       = local.use_local_zips ? aws_lambda_function.handler["email-inbound"].function_name : ""
}

# ---------------------------------------------------------------------------
# MCP custom domain — outputs consumed by `pnpm cf:sync-mcp`.
# ---------------------------------------------------------------------------

output "mcp_custom_domain" {
  description = "Configured MCP custom domain (e.g., mcp.thinkwork.ai), or empty string when disabled. The CF sync script reads this to know the target hostname."
  value       = var.mcp_custom_domain
}

output "mcp_custom_domain_cert_arn" {
  description = "ACM certificate ARN for the MCP custom domain, or empty when disabled. The sync script can use this to poll ACM validation status via aws acm describe-certificate."
  value       = var.mcp_custom_domain != "" ? aws_acm_certificate.mcp[0].arn : ""
}

output "mcp_custom_domain_validation" {
  description = "List of ACM DNS-validation records that must exist in Cloudflare before the cert is issued. Each record is { name, type, value }. Consumed by scripts/cloudflare-sync-mcp.ts."
  value = var.mcp_custom_domain != "" ? [
    for dvo in aws_acm_certificate.mcp[0].domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ] : []
}

output "mcp_custom_domain_target" {
  description = "Regional target for the final mcp.thinkwork.ai → API Gateway CNAME. Only populated on the second apply (when mcp_custom_domain_ready = true). Includes { target_domain_name, hosted_zone_id } so the CF sync script can upsert the record."
  value = var.mcp_custom_domain != "" && var.mcp_custom_domain_ready ? {
    target_domain_name = aws_apigatewayv2_domain_name.mcp[0].domain_name_configuration[0].target_domain_name
    hosted_zone_id     = aws_apigatewayv2_domain_name.mcp[0].domain_name_configuration[0].hosted_zone_id
  } : null
}
