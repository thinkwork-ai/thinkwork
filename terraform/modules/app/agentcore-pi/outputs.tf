################################################################################
# AgentCore Pi — App Module (outputs)
################################################################################

output "agentcore_pi_function_name" {
  description = "Pi AgentCore Lambda function name (for direct SDK invoke from chat-agent-invoke)"
  value       = aws_lambda_function.agentcore_pi.function_name
}

output "agentcore_pi_function_arn" {
  description = "Pi AgentCore Lambda function ARN (for IAM policy on callers; used to grant lambda:InvokeFunction)"
  value       = aws_lambda_function.agentcore_pi.arn
}

output "agentcore_pi_runtime_role_arn" {
  description = "IAM role ARN for the Pi agent runtime (assumed by Lambda + Bedrock AgentCore Runtime principals)"
  value       = aws_iam_role.agentcore_pi.arn
}

output "agentcore_pi_log_group_name" {
  description = "CloudWatch log group name for the Pi Lambda. Useful for log scrubbing and operator inspection."
  value       = aws_cloudwatch_log_group.agentcore_pi.name
}
