################################################################################
# ThinkWork Computer Runtime — shared ECS/EFS substrate
#
# This module intentionally creates shared substrate only. Per-Computer EFS
# access points, task-definition revisions, and ECS services are reconciled by
# the Computer manager Lambda from database rows.
################################################################################

resource "aws_ecr_repository" "runtime" {
  name                 = "thinkwork-${var.stage}-computer-runtime"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "thinkwork-${var.stage}-computer-runtime" }
}

resource "aws_cloudwatch_log_group" "runtime" {
  name              = "/thinkwork/${var.stage}/computer-runtime"
  retention_in_days = var.log_retention_days

  tags = { Name = "thinkwork-${var.stage}-computer-runtime-logs" }
}

resource "aws_ecs_cluster" "runtime" {
  name = "thinkwork-${var.stage}-computer"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "thinkwork-${var.stage}-computer-cluster" }
}

resource "aws_efs_file_system" "workspace" {
  creation_token = "thinkwork-${var.stage}-computer-workspaces"
  encrypted      = true

  tags = { Name = "thinkwork-${var.stage}-computer-workspaces" }
}

resource "aws_security_group" "task" {
  name_prefix = "thinkwork-${var.stage}-computer-task-"
  description = "ThinkWork Computer runtime task egress and EFS client access"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "thinkwork-${var.stage}-computer-task-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "efs" {
  name_prefix = "thinkwork-${var.stage}-computer-efs-"
  description = "ThinkWork Computer workspace EFS"
  vpc_id      = var.vpc_id

  ingress {
    description     = "NFS from Computer runtime tasks"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }

  tags = { Name = "thinkwork-${var.stage}-computer-efs-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_efs_mount_target" "workspace" {
  for_each = toset(var.subnet_ids)

  file_system_id  = aws_efs_file_system.workspace.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "aws_iam_role" "execution" {
  name = "thinkwork-${var.stage}-computer-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name = "thinkwork-${var.stage}-computer-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "task_secrets" {
  count = var.api_auth_secret_arn != "" ? 1 : 0
  name  = "computer-runtime-secret-read"
  role  = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.api_auth_secret_arn
    }]
  })
}

resource "aws_iam_policy" "manager" {
  name        = "thinkwork-${var.stage}-computer-manager"
  description = "Allow the Computer manager Lambda to reconcile per-Computer ECS/EFS resources"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:CreateAccessPoint",
          "elasticfilesystem:DescribeAccessPoints",
          "elasticfilesystem:DeleteAccessPoint",
          "elasticfilesystem:TagResource",
        ]
        Resource = [
          aws_efs_file_system.workspace.arn,
          "arn:aws:elasticfilesystem:${var.region}:${var.account_id}:access-point/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:CreateService",
          "ecs:UpdateService",
          "ecs:DeleteService",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
      },
    ]
  })
}
