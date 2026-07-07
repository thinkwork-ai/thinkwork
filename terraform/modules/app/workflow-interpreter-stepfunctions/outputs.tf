output "state_machine_arn" {
  description = "ARN of the shared workflow-interpreter state machine."
  value       = aws_sfn_state_machine.interpreter.arn
}

output "state_machine_name" {
  description = "Name of the shared workflow-interpreter state machine."
  value       = aws_sfn_state_machine.interpreter.name
}

output "state_machine_arn_ssm_parameter_name" {
  description = "SSM parameter name holding the interpreter machine ARN (read by graphql-http + job-trigger)."
  value       = aws_ssm_parameter.state_machine_arn.name
}

output "execution_role_arn" {
  description = "ARN of the Step Functions execution role assumed by the interpreter machine."
  value       = aws_iam_role.execution.arn
}

output "execution_role_name" {
  description = "Name of the Step Functions execution role."
  value       = aws_iam_role.execution.name
}

output "log_group_arn" {
  description = "CloudWatch log group ARN for interpreter execution histories."
  value       = aws_cloudwatch_log_group.interpreter.arn
}

output "log_group_name" {
  description = "CloudWatch log group name."
  value       = aws_cloudwatch_log_group.interpreter.name
}
