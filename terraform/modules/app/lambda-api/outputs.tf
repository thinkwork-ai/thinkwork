output "api_id" {
  description = "API Gateway V2 API ID"
  value       = aws_apigatewayv2_api.main.id
}

output "api_endpoint" {
  description = "Public HTTP API base URL. Uses the custom domain when configured so VPC runtimes with execute-api private DNS can still call service callbacks."
  value       = local.api_base_url
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

output "lambda_artifact_mode" {
  description = "Resolved Lambda artifact source mode: local, s3, or placeholder."
  value       = local.lambda_artifact_mode
}

output "memory_retain_fn_name" {
  description = "Memory-retain Lambda function name. Pi invokes this directly to push conversational turns into the active memory engine."
  value       = local.deploy_lambda_handlers ? aws_lambda_function.handler["memory-retain"].function_name : ""
}

output "memory_retain_fn_arn" {
  description = "Memory-retain Lambda ARN. Used to grant lambda:InvokeFunction to the Pi runtime role."
  value       = local.deploy_lambda_handlers ? aws_lambda_function.handler["memory-retain"].arn : ""
}

output "knowledge_graph_thread_ingest_fn_name" {
  description = "Knowledge Graph thread ingest worker Lambda function name."
  value       = local.deploy_lambda_handlers ? aws_lambda_function.handler["knowledge-graph-thread-ingest"].function_name : ""
}

output "knowledge_graph_thread_ingest_fn_arn" {
  description = "Knowledge Graph thread ingest worker Lambda ARN."
  value       = local.deploy_lambda_handlers ? aws_lambda_function.handler["knowledge-graph-thread-ingest"].arn : ""
}

output "okf_efs_refresh_fn_name" {
  description = "OKF EFS refresh Lambda function name."
  value       = local.deploy_lambda_handlers ? aws_lambda_function.handler["okf-efs-refresh"].function_name : ""
}

output "okf_efs_refresh_fn_arn" {
  description = "OKF EFS refresh Lambda ARN."
  value       = local.deploy_lambda_handlers ? aws_lambda_function.handler["okf-efs-refresh"].arn : ""
}

output "brain_artifacts_bucket_name" {
  description = "Canonical Company Brain S3 bucket for source artifacts, ingestion manifests, migration snapshots, vault projections, and exports."
  value       = aws_s3_bucket.brain_artifacts.bucket
}

output "brain_artifacts_bucket_arn" {
  description = "ARN of the canonical Company Brain artifact bucket."
  value       = aws_s3_bucket.brain_artifacts.arn
}

output "billing_export_bucket_name" {
  description = "Configured AWS billing export bucket consumed by the THNK-74 bill reconciler, or empty when not configured."
  value       = var.billing_export_bucket_name
}

output "billing_export_manifest_key" {
  description = "Configured AWS billing export manifest key consumed by the THNK-74 bill reconciler, or empty when not configured."
  value       = var.billing_export_manifest_key
}

output "email_inbound_fn_arn" {
  description = "email-inbound Lambda ARN. Used by the SES module to wire the receipt rule Lambda action."
  # Statically constructed (not a resource attribute): SES/customer-domain gate
  # count on this value, and an apply-time-unknown breaks the FIRST apply in a
  # fresh account ("Invalid count argument" — THINK-118 harness cycle 4).
  value = local.deploy_lambda_handlers ? "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-email-inbound" : ""
}

output "email_inbound_fn_name" {
  description = "email-inbound Lambda function name. Used by the SES module for lambda:InvokeFunction permissions."
  # Static for the same fresh-account plan-time reason as email_inbound_fn_arn.
  value       = local.deploy_lambda_handlers ? "thinkwork-${var.stage}-api-email-inbound" : ""
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
