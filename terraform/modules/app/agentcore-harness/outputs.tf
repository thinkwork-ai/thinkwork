output "execution_role_arn" {
  description = "ARN of the Harness execution role (CreateHarness executionRoleArn). Empty string when the module is disabled."
  value       = var.enabled ? aws_iam_role.harness_execution[0].arn : ""
}

output "execution_role_name" {
  description = "Name of the Harness execution role. Empty string when the module is disabled."
  value       = var.enabled ? aws_iam_role.harness_execution[0].name : ""
}
