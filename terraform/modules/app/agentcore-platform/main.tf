################################################################################
# AgentCore Platform — Shared App Module
#
# Owns shared AgentCore substrate that is not runtime-specific. Pi consumes the
# ECR repository for container images and the async DLQ for failed Event invokes.
################################################################################

variable "stage" {
  description = "Deployment stage"
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
# Async-invoke DLQ
################################################################################

resource "aws_sqs_queue" "agentcore_async_dlq" {
  name                       = "thinkwork-${var.stage}-agentcore-async-dlq"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 900     # matches runtime Lambda timeout
  sqs_managed_sse_enabled    = true

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-async-dlq"
  }
}

################################################################################
# Outputs
################################################################################

output "ecr_repository_url" {
  description = "ECR repository URL for AgentCore runtime container images"
  value       = aws_ecr_repository.agentcore.repository_url
}

output "agentcore_async_dlq_arn" {
  description = "SQS queue ARN that catches failed kind=run_skill async invokes"
  value       = aws_sqs_queue.agentcore_async_dlq.arn
}

output "agentcore_async_dlq_url" {
  description = "SQS queue URL for operator inspection of failed async invokes"
  value       = aws_sqs_queue.agentcore_async_dlq.url
}
