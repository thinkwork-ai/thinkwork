# Consumed by the API-side broker-session opener to build the sandbox
# SessionBootstrap. All null when the module is disabled (ship-inert).

output "enabled" {
  value = local.enabled
}

output "session_table_name" {
  description = "DynamoDB session table (CAPABILITY_BROKER_SESSION_TABLE)."
  value       = local.enabled ? aws_dynamodb_table.sessions[0].name : ""
}

output "session_table_arn" {
  description = "ARN of the broker session table — granted to the lambda-api role so routine-exec-git can mint/advance PoP sessions. Empty when disabled."
  value       = local.enabled ? aws_dynamodb_table.sessions[0].arn : ""
}

output "broker_audience" {
  description = "Audience the PoP session signatures are bound to (CAPABILITY_BROKER_AUDIENCE)."
  value       = local.enabled ? local.broker_audience : ""
}

output "private_api_id" {
  description = "Private REST API id the sandbox targets through the VPCE (CAPABILITY_BROKER_API_ID)."
  value       = local.enabled ? aws_api_gateway_rest_api.broker[0].id : ""
}

output "execute_api_vpce_id" {
  value = local.enabled ? aws_vpc_endpoint.broker_execute_api[0].id : ""
}

output "execute_api_vpce_dns_name" {
  description = "Endpoint-specific execute-api DNS name (private DNS is OFF). The session bootstrap uses this exact host — CAPABILITY_BROKER_VPCE_DNS."
  value       = local.enabled ? tolist(aws_vpc_endpoint.broker_execute_api[0].dns_entry)[0].dns_name : ""
}

output "broker_function_name" {
  value = local.enabled ? aws_lambda_function.broker[0].function_name : ""
}

# --- U4: capability-private interpreter VPC placement ------------------------
# Consumed by the agentcore-admin Lambda (CAPABILITY_PRIVATE_SUBNET_IDS /
# CAPABILITY_PRIVATE_SECURITY_GROUP_IDS). Empty lists when disabled so the
# Lambda skips capability-private provisioning entirely.

output "capability_private_interpreter_subnet_ids" {
  description = "No-NAT subnets the capability-private interpreter attaches to (same egress subnets as the broker)."
  value       = local.enabled ? var.subnet_ids : []
}

output "capability_private_interpreter_security_group_id" {
  description = "Egress-only SG (broker execute-api VPCE + DNS only) for the capability-private interpreter. Empty when disabled."
  value       = local.enabled ? aws_security_group.capability_private_interpreter[0].id : ""
}
