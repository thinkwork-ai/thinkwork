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

output "console_client_id" {
  value = module.cognito.console_client_id
}

output "identity_pool_id" {
  value = module.cognito.identity_pool_id
}

output "identity_provider_names" {
  description = "Supported Cognito identity providers for created app clients."
  value       = module.cognito.identity_provider_names
}

output "auth_route_clients" {
  description = "Safe Cognito app-client manifest for local, Google, Microsoft, and tenant Entra routes."
  value       = module.cognito.auth_route_clients
}

output "auth_retirement_phase" {
  description = "Applied authentication retirement phase used for safe controller upgrades."
  value       = module.cognito.auth_retirement_phase
}

output "web_local_client_id" {
  description = "Local-password-only Cognito app client for web login."
  value       = module.cognito.web_local_client_id
}

output "mobile_local_client_id" {
  description = "Local-password-only Cognito app client for mobile login."
  value       = module.cognito.mobile_local_client_id
}

output "microsoft_identity_provider_name" {
  value = module.cognito.microsoft_identity_provider_name
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

output "billing_export_bucket_name" {
  description = "Configured AWS billing export bucket consumed by the bill reconciler, or empty when not configured."
  value       = module.api.billing_export_bucket_name
}

output "billing_export_manifest_key" {
  description = "Configured AWS billing export manifest key consumed by the bill reconciler, or empty when not configured."
  value       = module.api.billing_export_manifest_key
}

output "backups_bucket_name" {
  description = "S3 bucket for operational backups (pre-drop snapshots from destructive migrations, via the aws_s3 Aurora extension)."
  value       = module.s3_backups.bucket_name
}

output "backups_bucket_arn" {
  description = "ARN of the operational backups bucket."
  value       = module.s3_backups.bucket_arn
}

output "aurora_aws_s3_iam_role_arn" {
  description = "IAM role ARN attached to the Aurora cluster for the aws_s3 extension. Null when backups are not wired (e.g. rds-postgres dev mode). Used in post-deploy runbooks to confirm the role association before running CREATE EXTENSION aws_s3."
  value       = module.database.aws_s3_iam_role_arn
}

# App
output "api_endpoint" {
  value = module.api.api_endpoint
}

output "lambda_artifact_mode" {
  description = "Resolved Lambda artifact source mode: local, s3, or placeholder."
  value       = module.api.lambda_artifact_mode
}

output "api_id" {
  description = "aws_apigatewayv2_api.main.id — needed by the www-dns module to map api.<domain> onto the HTTP API."
  value       = module.api.api_id
}

output "appsync_api_url" {
  value = module.appsync.graphql_api_url
}

output "appsync_realtime_url" {
  value = module.appsync.graphql_realtime_url
}

output "auth_domain" {
  description = "Cognito hosted UI domain"
  value       = module.cognito.auth_domain
}

output "deployment_control_plane_enabled" {
  description = "Whether the AWS-native deployment control plane is enabled."
  value       = var.enable_deployment_control_plane
}

output "deployment_state_machine_arn" {
  description = "Deployment orchestration Step Functions state machine ARN."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].state_machine_arn : (var.deployment_state_machine_arn != "" ? var.deployment_state_machine_arn : null)
}

output "deployment_state_machine_name" {
  description = "Deployment orchestration Step Functions state machine name."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].state_machine_name : null
}

output "deployment_runner_project_name" {
  description = "CodeBuild project name for the deployment runner."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].codebuild_project_name : null
}

output "deployment_runner_project_arn" {
  description = "CodeBuild project ARN for the deployment runner."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].codebuild_project_arn : null
}

output "deployment_evidence_bucket_name" {
  description = "S3 bucket for deployment evidence artifacts."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].evidence_bucket_name : (var.deployment_evidence_bucket != "" ? var.deployment_evidence_bucket : null)
}

output "deployment_ssm_prefix" {
  description = "SSM parameter prefix for deployment control-plane metadata."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].ssm_prefix : null
}

output "deployment_appconfig_application_id" {
  description = "AppConfig application ID for deployment configuration."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].appconfig_application_id : null
}

output "deployment_appconfig_environment_id" {
  description = "AppConfig environment ID for deployment configuration."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].appconfig_environment_id : null
}

output "deployment_appconfig_configuration_profile_id" {
  description = "AppConfig configuration profile ID for deployment configuration."
  value       = var.enable_deployment_control_plane ? module.deployment_control_plane[0].appconfig_configuration_profile_id : null
}

output "mapbox_public_token" {
  description = "Mapbox public token used by apps/web MapView. Surfaced for scripts/build-web.sh to inline as VITE_MAPBOX_PUBLIC_TOKEN at build time. MapView falls back to OSM tiles when this is empty."
  value       = var.mapbox_public_token
  sensitive   = true
}

output "ecr_repository_url" {
  value = module.agentcore_platform.ecr_repository_url
}

output "agentcore_memory_id" {
  description = "Bedrock AgentCore Memory resource ID (always present — managed memory is always on)"
  value       = module.agentcore_memory.memory_id
}

output "brain_artifacts_bucket_name" {
  description = "Canonical ThinkWork Brain S3 bucket for source artifacts, ingestion manifests, migration snapshots, vault projections, and exports."
  value       = module.api.brain_artifacts_bucket_name
}

output "brain_artifacts_bucket_arn" {
  description = "ARN of the canonical ThinkWork Brain artifact bucket."
  value       = module.api.brain_artifacts_bucket_arn
}

output "okf_wiki_efs_enabled" {
  description = "DEPRECATED (THINK-589): always false — the OKF wiki EFS substrate is no longer wired to any consumer. Removal pending (PR 2)."
  value       = false
}

output "okf_wiki_efs_file_system_id" {
  description = "DEPRECATED (THINK-589): ID of the orphaned OKF wiki EFS filesystem retained for PR 2's gated delete, or null. No consumer mounts it."
  value       = var.okf_wiki_efs_enabled ? aws_efs_file_system.okf_wiki[0].id : null
}

output "okf_wiki_refresh_access_point_arn" {
  description = "DEPRECATED (THINK-589): always null — the hydrator access point is removed. Removal pending (PR 2)."
  value       = null
}

output "okf_wiki_pi_read_access_point_arn" {
  description = "DEPRECATED (THINK-589): always null — the Pi read access point is removed. Removal pending (PR 2)."
  value       = null
}

output "twenty_provisioned" {
  description = "Whether the Twenty CRM retained managed-app substrate is provisioned"
  value       = local.twenty_provisioned
}

output "twenty_runtime_enabled" {
  description = "Whether the Twenty CRM server/worker runtime is enabled"
  value       = local.twenty_runtime_enabled
}

output "twenty_url" {
  description = "Public Twenty CRM URL (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_url : null
}

output "twenty_alb_dns_name" {
  description = "Public ALB DNS name for Twenty CRM (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_alb_dns_name : null
}

output "twenty_alb_arn" {
  description = "Public ALB ARN for Twenty CRM (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_alb_arn : null
}

output "twenty_target_group_arn" {
  description = "Target group ARN for Twenty CRM server (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_target_group_arn : null
}

output "twenty_cluster_arn" {
  description = "ECS cluster ARN for Twenty CRM (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_cluster_arn : null
}

output "twenty_server_service_name" {
  description = "ECS service name for the Twenty server (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_server_service_name : null
}

output "twenty_worker_service_name" {
  description = "ECS service name for the Twenty worker (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_worker_service_name : null
}

output "twenty_server_log_group_name" {
  description = "CloudWatch log group for the Twenty server (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_server_log_group_name : null
}

output "twenty_worker_log_group_name" {
  description = "CloudWatch log group for the Twenty worker (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_worker_log_group_name : null
}

output "twenty_cache_endpoint" {
  description = "ElastiCache primary endpoint for Twenty CRM (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_cache_endpoint : null
}

output "twenty_storage_file_system_id" {
  description = "EFS file system ID backing Twenty CRM local storage (null when twenty_provisioned = false)"
  value       = local.twenty_provisioned ? module.twenty[0].twenty_storage_file_system_id : null
}

output "n8n_provisioned" {
  description = "Whether the retained n8n substrate is provisioned"
  value       = local.n8n_provisioned
}

output "n8n_runtime_enabled" {
  description = "Whether n8n ECS services are configured to run"
  value       = local.n8n_runtime_enabled
}

output "n8n_url" {
  description = "Public n8n URL (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_url : null
}

output "n8n_alb_dns_name" {
  description = "Public ALB DNS name for n8n (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_alb_dns_name : null
}

output "n8n_alb_arn" {
  description = "Public ALB ARN for n8n (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_alb_arn : null
}

output "n8n_target_group_arn" {
  description = "Target group ARN for the n8n main service (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_target_group_arn : null
}

output "n8n_cluster_arn" {
  description = "ECS cluster ARN for n8n (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_cluster_arn : null
}

output "n8n_main_service_name" {
  description = "ECS service name for the n8n main service (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_main_service_name : null
}

output "n8n_worker_service_name" {
  description = "ECS service name for the n8n worker service (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_worker_service_name : null
}

output "n8n_main_log_group_name" {
  description = "CloudWatch log group for the n8n main service (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_main_log_group_name : null
}

output "n8n_worker_log_group_name" {
  description = "CloudWatch log group for the n8n worker service (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_worker_log_group_name : null
}

output "n8n_database_name" {
  description = "Dedicated n8n database name (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_database_name : null
}

output "n8n_database_secret_arn" {
  description = "Secrets Manager ARN used for n8n database runtime credentials (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_database_secret_arn : null
}

output "n8n_valkey_endpoint" {
  description = "ElastiCache primary endpoint for n8n queue mode (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_valkey_endpoint : null
}

output "n8n_storage_bucket_name" {
  description = "S3 bucket name used for n8n managed artifacts (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_storage_bucket_name : null
}

output "n8n_storage_prefix" {
  description = "S3 prefix reserved for n8n managed artifacts (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_storage_prefix : null
}

output "n8n_image_digest" {
  description = "Immutable digest extracted from the n8n wrapper image URI (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_image_digest : null
}

output "n8n_package_config_digest" {
  description = "Digest of the reviewed n8n custom-package configuration (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_package_config_digest : null
}

output "n8n_service_credential_secret_arn" {
  description = "Secrets Manager ARN used for the n8n MCP tenant service credential (null when n8n_provisioned = false)"
  value       = local.n8n_provisioned ? module.n8n[0].n8n_service_credential_secret_arn : null
}

output "admin_url" {
  description = "Deprecated compatibility alias for app_url"
  value       = local.end_user_app_url
}

locals {
  end_user_app_url = local.end_user_app_domain != "" ? "https://${local.end_user_app_domain}" : "https://${module.computer_site.distribution_domain}"
}

# End-user app static site (apps/web).
output "app_distribution_id" {
  description = "CloudFront distribution ID for the end-user app"
  value       = module.computer_site.distribution_id
}

output "app_distribution_domain" {
  description = "CloudFront domain for the end-user app"
  value       = module.computer_site.distribution_domain
}

output "app_bucket_name" {
  description = "S3 bucket for end-user app assets"
  value       = module.computer_site.bucket_name
}

output "app_url" {
  description = "Public URL for the end-user app (delegated customer domain first, then custom app domain, CloudFront default otherwise)"
  value       = local.end_user_app_url
}

# Customer domain (<name>.thinkwork.ai). Zone outputs are populated as soon
# as customer_domain is set; the certificate output waits for the
# customer_domain_delegated gate. The name servers are the phase-two input
# for the namespace claim tool's `claim --set-targets <ns...>`.
output "customer_domain" {
  description = "Customer domain configured for this deployment (empty when none)"
  value       = var.customer_domain
}

output "customer_domain_zone_id" {
  description = "Route53 hosted zone ID for the customer domain (empty when no customer domain is configured)"
  value       = module.customer_domain.zone_id
}

output "customer_domain_name_servers" {
  description = "The four Route53 name servers for the customer-domain zone — publish these via the claim tool's `claim --set-targets` to delegate (empty when no customer domain is configured)"
  value       = module.customer_domain.name_servers
}

output "customer_domain_certificate_arn" {
  description = "Validated ACM certificate ARN for the customer domain (us-east-1; empty until customer_domain_delegated is true)"
  value       = module.customer_domain.certificate_arn
}

output "customer_domain_ses_identity_arn" {
  description = "SES domain identity ARN for the customer domain (empty when no customer domain is configured). Candidate cognito_email_source_arn value — switching Cognito email to it is an operator action taken only after the identity verifies and SES production access is granted (R11), never automatic."
  value       = module.customer_domain.ses_identity_arn
}

output "customer_domain_ses_rule_set_name" {
  description = "SES receipt rule set name owned by the customer-domain module (empty when no customer domain is configured). Active only when the ses-email module is disabled in this account — KTD6."
  value       = module.customer_domain.rule_set_name
}

# Deprecated compatibility aliases. Keep these stable for existing scripts and
# external callers while the source path is apps/web.
output "computer_distribution_id" {
  description = "Deprecated alias for app_distribution_id"
  value       = module.computer_site.distribution_id
}

output "computer_distribution_domain" {
  description = "Deprecated alias for app_distribution_domain"
  value       = module.computer_site.distribution_domain
}

output "computer_bucket_name" {
  description = "Deprecated alias for app_bucket_name"
  value       = module.computer_site.bucket_name
}

output "computer_url" {
  description = "Deprecated alias for app_url"
  value       = local.end_user_app_url
}

# Computer sandbox subdomain (plan-012 U3 / U11.5 — iframe-isolated
# fragment substrate). Provisioned only when var.computer_sandbox_domain
# is set. scripts/build-web.sh reads these to sync the iframe-shell
# bundle and invalidate the sandbox distribution.
output "computer_sandbox_distribution_id" {
  description = "CloudFront distribution ID for the iframe-isolated sandbox subdomain (empty when not provisioned)"
  value       = local.computer_sandbox_enabled ? module.computer_sandbox_site[0].distribution_id : ""
}

output "computer_sandbox_distribution_domain" {
  description = "CloudFront domain for the sandbox subdomain (empty when not provisioned)"
  value       = local.computer_sandbox_enabled ? module.computer_sandbox_site[0].distribution_domain : ""
}

output "computer_sandbox_bucket_name" {
  description = "S3 bucket holding the iframe-shell bundle for the sandbox subdomain (empty when not provisioned)"
  value       = local.computer_sandbox_enabled ? module.computer_sandbox_site[0].bucket_name : ""
}

output "computer_sandbox_url" {
  description = "Public URL for the iframe-shell host (empty when not provisioned). The host app's __SANDBOX_IFRAME_SRC__ Vite define points at <url>/iframe-shell.html."
  value       = local.computer_sandbox_enabled ? "https://${var.computer_sandbox_domain}" : ""
}

output "computer_sandbox_allowed_parent_origins" {
  description = "Comma-separated list of trusted parent origins for the iframe-shell. Mirrors the CSP frame-ancestors directive on the sandbox distribution and is wired into the iframe-shell's __ALLOWED_PARENT_ORIGINS__ Vite define at build time."
  value       = local.computer_sandbox_allowed_parent_origins_effective
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

# SES inbound email
output "ses_inbound_zone_ids" {
  description = "Route53 hosted zone IDs for tenant email subdomains, keyed by tenant slug"
  value       = module.ses.zone_ids
}

output "ses_inbound_zone_id" {
  description = "Route53 hosted zone ID for the legacy email subdomain (null when ses_inbound_domain is not set)"
  value       = module.ses.zone_id
}

output "ses_tenant_name_servers" {
  description = "Name servers for delegated tenant email subzones, keyed by tenant slug. Publish each set as NS records at the parent domain host before SES can verify."
  value       = module.ses.tenant_name_servers
}

output "ses_inbound_name_servers" {
  description = "Name servers for the legacy delegated email subzone. Keep until legacy-address retirement notices are no longer needed."
  value       = module.ses.name_servers
}

output "ses_inbound_mx_target" {
  description = "MX target host for tenant email subdomains. Terraform already writes this into each subzone — this output is informational."
  value       = module.ses.mx_target
}

# MCP custom domain — consumed by `pnpm cf:sync-mcp`.
output "mcp_custom_domain" {
  description = "Configured MCP custom domain (e.g., mcp.thinkwork.ai), or empty when disabled."
  value       = module.api.mcp_custom_domain
}

output "mcp_custom_domain_cert_arn" {
  description = "ACM cert ARN for the MCP custom domain. Used by the CF sync script to poll validation status."
  value       = module.api.mcp_custom_domain_cert_arn
}

output "mcp_custom_domain_validation" {
  description = "DNS validation records that must be added to Cloudflare for ACM to issue the cert. Each record: { name, type, value }."
  value       = module.api.mcp_custom_domain_validation
}

output "mcp_custom_domain_target" {
  description = "Regional target for the final mcp CNAME — only populated on the second apply after mcp_custom_domain_ready=true. { target_domain_name, hosted_zone_id } or null."
  value       = module.api.mcp_custom_domain_target
}

# Phase 3 U7 — Compliance audit-anchor bucket (S3 Object Lock). Consumed by
# operator runbooks for post-deploy verification (`aws s3api get-object-lock-
# configuration`) and by U8a/U8b when the anchor Lambda lands.

output "compliance_anchor_bucket_arn" {
  description = "ARN of the WORM-protected compliance audit-anchor S3 bucket."
  value       = module.compliance_anchors.bucket_arn
}

output "compliance_anchor_bucket_name" {
  description = "Name of the WORM-protected compliance audit-anchor S3 bucket (thinkwork-{stage}-compliance-anchors)."
  value       = module.compliance_anchors.bucket_name
}

output "compliance_anchor_lambda_role_arn" {
  description = "ARN of the IAM role the anchor Lambda (U8a/U8b) will assume. Inert in U7 — no Lambda function references this yet."
  value       = module.compliance_anchors.lambda_role_arn
}

# Capability broker (THINK-280 U3) — ship-inert; all empty until
# var.enable_capability_broker flips on. The API-side session opener reads
# these to build the sandbox SessionBootstrap.
output "capability_broker_enabled" {
  description = "Whether the governed capability broker infra is provisioned."
  value       = module.capability_broker.enabled
}

output "capability_broker_session_table_name" {
  description = "DynamoDB session table (CAPABILITY_BROKER_SESSION_TABLE). Empty when disabled."
  value       = module.capability_broker.session_table_name
}

output "capability_broker_audience" {
  description = "PoP session audience (CAPABILITY_BROKER_AUDIENCE). Empty when disabled."
  value       = module.capability_broker.broker_audience
}

output "capability_broker_private_api_id" {
  description = "Private REST API id the sandbox targets through the VPCE (CAPABILITY_BROKER_API_ID). Empty when disabled."
  value       = module.capability_broker.private_api_id
}

output "capability_broker_vpce_dns_name" {
  description = "Endpoint-specific execute-api VPCE DNS name (private DNS OFF; CAPABILITY_BROKER_VPCE_DNS). Empty when disabled."
  value       = module.capability_broker.execute_api_vpce_dns_name
}

# THINK-280 U4 — VPC placement for the capability-private interpreter, threaded
# to the agentcore-admin Lambda (CAPABILITY_PRIVATE_SUBNET_IDS /
# CAPABILITY_PRIVATE_SECURITY_GROUP_IDS) when U5/U6 wire that handler. Empty
# when the broker is disabled, so the Lambda skips capability-private entirely.
output "capability_private_interpreter_subnet_ids" {
  description = "No-NAT subnets the capability-private VPC-mode interpreter attaches to. Empty when the broker is disabled."
  value       = module.capability_broker.capability_private_interpreter_subnet_ids
}

output "capability_private_interpreter_security_group_id" {
  description = "Egress-only SG (broker execute-api VPCE + DNS only) for the capability-private interpreter. Empty when the broker is disabled."
  value       = module.capability_broker.capability_private_interpreter_security_group_id
}

# AgentCore Harness managed runtime outputs. Rollout-era `*_proof_*` aliases
# remain below so existing automation can migrate without replacing resources.
output "agentcore_multiplayer_proof_workload_identity_arn" {
  description = "Manual proof workload identity ARN used only for U1 Identity verification."
  value       = module.agentcore_proof_identity.workload_identity_arn
}

output "agentcore_multiplayer_proof_credential_provider_arn" {
  description = "Synthetic proof OAuth credential provider ARN."
  value       = module.agentcore_proof_identity.credential_provider_arn
}
