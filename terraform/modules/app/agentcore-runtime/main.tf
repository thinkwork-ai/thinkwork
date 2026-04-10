################################################################################
# AgentCore Runtime — App Module
#
# Creates ECR repository, IAM roles, and container build infrastructure
# for the Strands-based agent runtime. Full implementation ported in Phase 3.
# Phase 1 creates the ECR repo and IAM scaffolding only.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "bucket_name" {
  description = "Primary S3 bucket for skills and workspace files"
  type        = string
}

################################################################################
# ECR Repository
################################################################################

resource "aws_ecr_repository" "agentcore" {
  name                 = "thinkwork-${var.stage}-agentcore"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-agentcore"
  }
}

resource "aws_ecr_lifecycle_policy" "agentcore" {
  repository = aws_ecr_repository.agentcore.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

################################################################################
# Execution Role
################################################################################

resource "aws_iam_role" "agentcore" {
  name = "thinkwork-${var.stage}-agentcore-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["ecs-tasks.amazonaws.com", "lambda.amazonaws.com"] }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "agentcore" {
  name = "agentcore-permissions"
  role = aws_iam_role.agentcore.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Access"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.bucket_name}",
          "arn:aws:s3:::${var.bucket_name}/*",
        ]
      },
      {
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:InvokeAgent"]
        Resource = "*"
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:*"
      },
      {
        Sid      = "ECRPull"
        Effect   = "Allow"
        Action   = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:GetAuthorizationToken"]
        Resource = "*"
      },
    ]
  })
}

################################################################################
# CloudWatch Log Group
################################################################################

resource "aws_cloudwatch_log_group" "agentcore" {
  name              = "/thinkwork/${var.stage}/agentcore"
  retention_in_days = 30

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-logs"
  }
}

################################################################################
# Outputs
################################################################################

output "ecr_repository_url" {
  description = "ECR repository URL for the AgentCore container"
  value       = aws_ecr_repository.agentcore.repository_url
}

output "execution_role_arn" {
  description = "IAM role ARN for AgentCore execution"
  value       = aws_iam_role.agentcore.arn
}
