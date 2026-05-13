output "cluster_name" {
  value = aws_ecs_cluster.runtime.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.runtime.arn
}

output "efs_file_system_id" {
  value = aws_efs_file_system.workspace.id
}

output "efs_file_system_arn" {
  value = aws_efs_file_system.workspace.arn
}

output "task_security_group_id" {
  value = aws_security_group.task.id
}

output "efs_security_group_id" {
  value = aws_security_group.efs.id
}

output "workspace_admin_access_point_arn" {
  value = aws_efs_access_point.workspace_admin.arn
}

output "workspace_admin_access_point_id" {
  value = aws_efs_access_point.workspace_admin.id
}

output "workspace_admin_lambda_sg_id" {
  value = aws_security_group.workspace_admin_lambda.id
}

output "subnet_ids" {
  value = var.subnet_ids
}

output "task_subnet_ids" {
  value = local.task_subnet_ids
}

output "assign_public_ip" {
  value = local.assign_public_ip
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.runtime.name
}

output "repository_url" {
  value = aws_ecr_repository.runtime.repository_url
}

output "default_cpu" {
  value = var.default_cpu
}

output "default_memory" {
  value = var.default_memory
}

output "manager_policy_arn" {
  value = aws_iam_policy.manager.arn
}
