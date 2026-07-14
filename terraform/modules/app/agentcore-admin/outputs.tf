output "lambda_arn" {
  description = "ARN of the agentcore-admin Lambda (AGENTCORE_ADMIN_LAMBDA_ARN for graphql-http). Empty when not deployed."
  value       = local.deploy ? aws_lambda_function.admin[0].arn : ""
}

output "lambda_function_name" {
  description = "Function name of the agentcore-admin Lambda. Empty when not deployed."
  value       = local.deploy ? aws_lambda_function.admin[0].function_name : ""
}

output "admin_token" {
  description = "Bearer token graphql-http presents on invoke (AGENTCORE_ADMIN_TOKEN). Empty when not deployed."
  value       = local.deploy ? random_password.admin_token[0].result : ""
  sensitive   = true
}

output "admin_token_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the admin bearer token. Empty when not deployed."
  value       = local.deploy ? aws_secretsmanager_secret.admin_token[0].arn : ""
}
