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

variable "hindsight_endpoint" {
  description = "Hindsight API endpoint. Empty string (default) disables Hindsight tools in the container; set to an endpoint URL to enable Hindsight as an add-on alongside the always-on managed memory."
  type        = string
  default     = ""
}

variable "agentcore_memory_id" {
  description = "AgentCore Memory resource ID. Populated automatically by the agentcore-memory module; injected into the container as AGENTCORE_MEMORY_ID for auto-retention."
  type        = string
  default     = ""
}

variable "memory_engine" {
  description = "Active long-term memory engine ('hindsight' or 'agentcore'). Controls whether the container auto-retains each turn into AgentCore Memory after a response; when 'hindsight' is active, auto-retention is skipped so we don't pay for writes no recall path reads."
  type        = string
  default     = "hindsight"
  validation {
    condition     = contains(["hindsight", "agentcore"], var.memory_engine)
    error_message = "memory_engine must be 'hindsight' or 'agentcore'."
  }
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
      Principal = { Service = ["ecs-tasks.amazonaws.com", "lambda.amazonaws.com", "bedrock-agentcore.amazonaws.com"] }
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
        Resource = "arn:aws:bedrock:${var.region}::foundation-model/*"
      },
      {
        # Automatic memory retention — every agent turn calls CreateEvent
        # to feed AgentCore's background strategies. Also needs read access
        # so the recall() tool can fetch previously extracted records and
        # so forget() can soft-archive old records.
        Sid    = "AgentCoreMemoryReadWrite"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:RetrieveMemoryRecords",
          "bedrock-agentcore:GetMemoryRecord",
          "bedrock-agentcore:BatchCreateMemoryRecords",
          "bedrock-agentcore:BatchUpdateMemoryRecords",
        ]
        Resource = "*"
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/thinkwork-${var.stage}-*"
      },
      {
        Sid      = "ECRPull"
        Effect   = "Allow"
        Action   = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "arn:aws:ecr:${var.region}:${var.account_id}:repository/thinkwork-${var.stage}-*"
      },
      {
        Sid      = "ECRAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "SSMParameterAccess"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/agentcore/*"
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
# Lambda Container Image
################################################################################

resource "aws_lambda_function" "agentcore" {
  function_name = "thinkwork-${var.stage}-agentcore"
  role          = aws_iam_role.agentcore.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.agentcore.repository_url}:latest"
  timeout       = 900
  memory_size   = 2048

  environment {
    variables = {
      PORT                   = "8080"
      AWS_LWA_PORT           = "8080"
      AGENTCORE_MEMORY_ID    = var.agentcore_memory_id
      AGENTCORE_FILES_BUCKET = var.bucket_name
      MEMORY_ENGINE          = var.memory_engine
    }
  }

  logging_config {
    log_group  = aws_cloudwatch_log_group.agentcore.name
    log_format = "Text"
  }

  tags = {
    Name = "thinkwork-${var.stage}-agentcore"
  }
}

# AgentCore is invoked directly via the Lambda SDK (InvokeCommand) from
# chat-agent-invoke — no Function URL is needed, and exposing one would be
# a public attack surface for prompt injection.

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

output "agentcore_function_name" {
  description = "AgentCore Lambda function name (for direct SDK invoke)"
  value       = aws_lambda_function.agentcore.function_name
}

output "agentcore_function_arn" {
  description = "AgentCore Lambda function ARN (for IAM policy on callers)"
  value       = aws_lambda_function.agentcore.arn
}
