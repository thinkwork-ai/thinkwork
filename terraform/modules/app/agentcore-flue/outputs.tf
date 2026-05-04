################################################################################
# AgentCore Flue — App Module (outputs)
################################################################################

output "flue_function_name" {
  description = "Flue AgentCore Lambda function name (for direct SDK invoke from chat-agent-invoke)"
  value       = aws_lambda_function.agentcore_flue.function_name
}

output "flue_function_arn" {
  description = "Flue AgentCore Lambda function ARN (for IAM policy on callers; used to grant lambda:InvokeFunction)"
  value       = aws_lambda_function.agentcore_flue.arn
}

output "flue_runtime_role_arn" {
  description = "IAM role ARN for the Flue agent runtime (assumed by Lambda + Bedrock AgentCore Runtime principals)"
  value       = aws_iam_role.agentcore_flue.arn
}

output "flue_log_group_name" {
  description = "CloudWatch log group name for the Flue Lambda. Useful for log scrubbing and operator inspection."
  value       = aws_cloudwatch_log_group.agentcore_flue.name
}
