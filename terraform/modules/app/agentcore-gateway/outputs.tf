output "gateway_id" {
  description = "AgentCore Gateway id. Empty when disabled."
  value       = var.enabled ? data.external.gateway_state[0].result.gateway_id : ""
}

output "gateway_arn" {
  description = "AgentCore Gateway ARN. Empty when disabled."
  value       = var.enabled ? data.external.gateway_state[0].result.gateway_arn : ""
}

output "gateway_url" {
  description = "AgentCore Gateway MCP endpoint. Empty when disabled."
  value       = var.enabled ? data.external.gateway_state[0].result.gateway_url : ""
}

output "target_id" {
  description = "Controlled OpenAPI target id. Empty when disabled."
  value       = var.enabled ? data.external.gateway_state[0].result.target_id : ""
}

output "target_name" {
  description = "Controlled OpenAPI target name."
  value       = var.enabled ? local.target_name : ""
}

output "policy_engine_id" {
  description = "Policy engine id. Empty when disabled."
  value       = var.enabled ? data.external.gateway_state[0].result.policy_engine_id : ""
}

output "policy_id" {
  description = "Owner-isolation Cedar policy id. Empty when disabled."
  value       = var.enabled ? data.external.gateway_state[0].result.policy_id : ""
}

output "execution_role_arn" {
  description = "Dedicated proof Gateway execution role ARN. Empty when disabled."
  value       = var.enabled ? aws_iam_role.gateway_execution[0].arn : ""
}
