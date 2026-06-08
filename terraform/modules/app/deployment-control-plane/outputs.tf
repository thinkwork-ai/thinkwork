output "state_machine_arn" {
  description = "ARN of the deployment orchestration Step Functions state machine."
  value       = aws_sfn_state_machine.deployment.arn
}

output "state_machine_name" {
  description = "Name of the deployment orchestration Step Functions state machine."
  value       = aws_sfn_state_machine.deployment.name
}

output "codebuild_project_name" {
  description = "Name of the deployment runner CodeBuild project."
  value       = aws_codebuild_project.runner.name
}

output "codebuild_project_arn" {
  description = "ARN of the deployment runner CodeBuild project."
  value       = aws_codebuild_project.runner.arn
}

output "evidence_bucket_name" {
  description = "S3 bucket that stores deployment evidence artifacts."
  value       = aws_s3_bucket.evidence.bucket
}

output "evidence_bucket_arn" {
  description = "ARN of the deployment evidence bucket."
  value       = aws_s3_bucket.evidence.arn
}

output "ssm_prefix" {
  description = "SSM parameter prefix for stable deployment control-plane identifiers."
  value       = local.ssm_prefix
}

output "appconfig_application_id" {
  description = "AppConfig application ID for versioned deployment configuration."
  value       = aws_appconfig_application.deployment.id
}

output "appconfig_environment_id" {
  description = "AppConfig environment ID for this deployment stage."
  value       = aws_appconfig_environment.deployment.environment_id
}

output "appconfig_configuration_profile_id" {
  description = "AppConfig hosted configuration profile ID for deployment config."
  value       = aws_appconfig_configuration_profile.deployment.configuration_profile_id
}

output "secret_arns" {
  description = "Placeholder deployment secret ARNs keyed by purpose."
  value       = { for key, secret in aws_secretsmanager_secret.deployment : key => secret.arn }
}
