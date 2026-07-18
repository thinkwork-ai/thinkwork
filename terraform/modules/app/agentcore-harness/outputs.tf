output "execution_role_arn" {
  description = "ARN of the Harness execution role (CreateHarness executionRoleArn). Empty string when the module is disabled."
  value       = var.enabled ? aws_iam_role.harness_execution[0].arn : ""
}

output "execution_role_name" {
  description = "Name of the Harness execution role. Empty string when the module is disabled."
  value       = var.enabled ? aws_iam_role.harness_execution[0].name : ""
}

output "managed_harness_id" {
  description = "Service-generated managed Harness id. Empty when the managed runtime is disabled."
  value       = var.managed_runtime_enabled ? data.external.harness_state[0].result.harness_id : ""
}

output "managed_harness_arn" {
  description = "One tenant/profile Harness ARN. Empty when disabled."
  value       = var.managed_runtime_enabled ? data.external.harness_state[0].result.harness_arn : ""
}

output "managed_endpoint_name" {
  description = "Named Harness endpoint qualifier. Empty when disabled."
  value       = var.managed_runtime_enabled ? local.endpoint_name : ""
}

output "managed_endpoint_arn" {
  description = "Named Harness endpoint ARN. Empty when disabled."
  value       = var.managed_runtime_enabled ? data.external.harness_state[0].result.endpoint_arn : ""
}

output "managed_target_version" {
  description = "Immutable Harness version attested by the named endpoint. Empty when disabled."
  value       = var.managed_runtime_enabled ? data.external.harness_state[0].result.target_version : ""
}

output "managed_live_version" {
  description = "Live version returned by the endpoint readback. Must equal managed_target_version for readiness."
  value       = var.managed_runtime_enabled ? data.external.harness_state[0].result.live_version : ""
}

output "managed_model_id" {
  description = "Actual Bedrock model configured on the immutable Harness version."
  value       = var.managed_runtime_enabled ? var.model_id : ""
}

output "managed_status" {
  description = "Derived safe readiness state: disabled, provisioning, ready, drifted, or misconfigured."
  value = !var.managed_runtime_enabled ? "disabled" : (
    data.external.harness_state[0].result.harness_status != "READY" || data.external.harness_state[0].result.endpoint_status != "READY" ? "provisioning" : (
      data.external.harness_state[0].result.target_version != data.external.harness_state[0].result.live_version ? "drifted" : "ready"
    )
  )
}

output "managed_configuration_fingerprint" {
  description = "Non-secret fingerprint of the stable tenant/profile Harness ceiling."
  value       = var.managed_runtime_enabled ? local.configuration_hash : ""
}
