################################################################################
# ThinkWork Computer Runtime — shared ECS/EFS substrate
#
# This module intentionally creates shared substrate only. Per-Computer EFS
# access points, task-definition revisions, and ECS services are reconciled by
# the Computer manager Lambda from database rows.
################################################################################

locals {
  task_subnet_ids  = length(var.task_subnet_ids) > 0 ? var.task_subnet_ids : var.subnet_ids
  assign_public_ip = var.assign_public_ip ? "ENABLED" : "DISABLED"
}

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

resource "aws_cloudwatch_log_group" "ecs_exec" {
  name              = "/thinkwork/${var.stage}/computer-ecs-exec"
  retention_in_days = var.log_retention_days

  tags = { Name = "thinkwork-${var.stage}-computer-ecs-exec-logs" }
}

resource "aws_ecs_cluster" "runtime" {
  name = "thinkwork-${var.stage}-computer"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  # ECS Exec audit-log destination. Per-session command streams land in this
  # log group once enable_execute_command=true is set on the per-Computer
  # service AND the task role has ssmmessages:Create/OpenControl+DataChannel.
  # CloudTrail captures the ExecuteCommand API call separately. Plan:
  # docs/plans/2026-05-13-004-feat-computer-terminal-ecs-exec-plan.md.
  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
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

resource "aws_security_group" "vpc_endpoints" {
  name_prefix = "thinkwork-${var.stage}-computer-vpce-"
  description = "PrivateLink endpoints for Computer runtime image pulls and logs"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTPS from Computer runtime tasks"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }

  tags = { Name = "thinkwork-${var.stage}-computer-vpce-sg" }
  lifecycle { create_before_destroy = true }
}

data "aws_route_table" "computer_subnet" {
  for_each  = toset(var.subnet_ids)
  subnet_id = each.value
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset([
    "bedrock-runtime",
    "ecr.api",
    "ecr.dkr",
    "logs",
  ])

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = { Name = "thinkwork-${var.stage}-computer-${replace(each.value, ".", "-")}-vpce" }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = distinct([for rt in data.aws_route_table.computer_subnet : rt.id])

  tags = { Name = "thinkwork-${var.stage}-computer-s3-vpce" }
}

resource "aws_efs_mount_target" "workspace" {
  for_each = toset(var.subnet_ids)

  file_system_id  = aws_efs_file_system.workspace.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

# Shared access point that lets the admin `workspace-files-efs` Lambda read
# any Computer's workspace directly without going through the per-Computer
# runtime task queue. Per-Computer access points (created lazily by
# provisionComputerRuntime) chroot the runtime to a single
# /tenants/<tenantId>/computers/<computerId> subpath. This admin access point
# is rooted higher at /tenants so a single Lambda can resolve any
# (tenantId, computerId) at request time. uid/gid 1000 matches the PosixUser
# used for the per-Computer access points (see
# packages/api/src/lib/computers/runtime-control.ts:createAccessPoint), so the
# Lambda reads files the runtime wrote with consistent ownership.
resource "aws_efs_access_point" "workspace_admin" {
  file_system_id = aws_efs_file_system.workspace.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/tenants"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "750"
    }
  }

  tags = { Name = "thinkwork-${var.stage}-computer-workspaces-admin" }
}

# Lambda SG that mounts the shared workspace EFS. Reuses the same NFS allow-
# from rule pattern as the per-Computer task SG; created as a sibling so
# Lambda traffic is auditable separately from task traffic.
resource "aws_security_group" "workspace_admin_lambda" {
  name_prefix = "thinkwork-${var.stage}-workspace-admin-lambda-"
  description = "ThinkWork workspace-files-efs Lambda - EFS client"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "thinkwork-${var.stage}-workspace-admin-lambda-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group_rule" "efs_from_workspace_admin_lambda" {
  description              = "NFS from workspace-files-efs Lambda"
  type                     = "ingress"
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  security_group_id        = aws_security_group.efs.id
  source_security_group_id = aws_security_group.workspace_admin_lambda.id
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

resource "aws_iam_role_policy" "task_bedrock" {
  name = "computer-runtime-bedrock"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:*:${var.account_id}:inference-profile/*",
      ]
    }]
  })
}

resource "aws_iam_role_policy" "task_agentcore" {
  name = "computer-runtime-agentcore"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:runtime/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/agentcore/runtime-id-strands"
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_appsync" {
  count = var.appsync_api_arn != "" ? 1 : 0
  name  = "computer-runtime-appsync"
  role  = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["appsync:GraphQL"]
      Resource = "${var.appsync_api_arn}/types/Mutation/fields/publishComputerThreadChunk"
    }]
  })
}

# ECS Exec — lets the in-task SSM agent open a control + data channel back
# to ssmmessages. Required for the admin Terminal tab (browser MGS
# WebSocket terminates at ssmmessages, which fans out to the agent in the
# task via these channels). Plus CloudWatch Logs PutLogEvents so the
# per-session command transcript lands in the cluster's exec log group.
resource "aws_iam_role_policy" "task_ssm_messages" {
  name = "computer-runtime-ssm-messages"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.ecs_exec.arn}:*"
      },
    ]
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
          # Admin Terminal tab — computer-terminal-start opens an
          # interactive shell via ECS Exec. AWS scopes ExecuteCommand
          # by task ARN; we leave Resource="*" because tasks are
          # ephemeral and their ARNs are not known at policy-apply
          # time. The Lambda's per-request authz (tenant-admin + the
          # Computer's tenant_id match) is the actual gate.
          "ecs:ExecuteCommand",
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
