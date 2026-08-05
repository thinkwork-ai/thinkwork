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

variable "release_mirror_principal_arns" {
  description = "IAM principals allowed to mirror release runtime images into this stage's AgentCore ECR repository. AgentCore Runtime is arm64-only and the deployment runner resolves the runtime image from THIS account's ECR by the '<releaseVersion>-pi-arm64' tag, so the ThinkWork release pipeline must be able to push it (THINK-616). Set to [] to disable the cross-account grant and mirror by hand."
  type        = list(string)
  default     = []
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
      description  = "Expire stale untagged images; retain tagged release/runtime pins"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = {
        type = "expire"
      }
    }]
  })
}

################################################################################
# Cross-account release-image mirror grant (THINK-616)
#
# The release workflow's `mirror-customer-images` job pushes
# `<releaseVersion>-pi-arm64` into this repository from the ThinkWork release
# account. A repository policy is the whole grant — no role, user, or key is
# provisioned here.
#
# `aws_ecr_repository_policy` REPLACES the repository policy document, so the
# Lambda image-retrieval statement that Lambda auto-attaches when a container
# function is created is restated here; dropping it would leave the Pi Lambda's
# image pull ungranted.
################################################################################

data "aws_caller_identity" "current" {}

resource "aws_ecr_repository_policy" "agentcore" {
  count = length(var.release_mirror_principal_arns) > 0 ? 1 : 0

  repository = aws_ecr_repository.agentcore.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LambdaECRImageRetrievalPolicy"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Condition = {
          StringLike = {
            "aws:sourceArn" = "arn:aws:lambda:*:${data.aws_caller_identity.current.account_id}:function:*"
          }
        }
      },
      {
        Sid    = "ThinkWorkReleaseImageMirror"
        Effect = "Allow"
        Principal = {
          AWS = var.release_mirror_principal_arns
        }
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:ListImages",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
      },
    ]
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
