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
