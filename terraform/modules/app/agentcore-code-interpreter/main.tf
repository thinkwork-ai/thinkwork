################################################################################
# AgentCore Code Interpreter — App Module (stage-level)
#
# Stage-scoped artifacts for the AgentCore Code Interpreter sandbox:
#   * ECR repository for the blessed sandbox base image (Python 3.12 +
#     pinned libs + sitecustomize.py R13 scrubber baked in).
#   * Lifecycle policy to trim old images.
#   * Outputs the per-tenant provisioning Lambda (Unit 5) consumes to
#     CreateCodeInterpreter for each tenant on demand.
#
# **Per-tenant resources live elsewhere.** AgentCore Code Interpreter
# instances are created per-tenant by the ``agentcore-admin`` Lambda at
# tenant-create time — see docs/adrs/per-tenant-aws-resource-fanout.md.
# This module stops at the stage-level substrate.
#
# **Image build.** The Dockerfile.sandbox-base next to this file is built
# and pushed by a CI job (scripts/build_and_push_sandbox_base.sh) — not by
# Terraform. Terraform owns the ECR repo and IAM plumbing; the image
# lifecycle is intentionally owned by CI so a repository bump is a
# reviewable PR rather than a ``terraform apply`` side-effect.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "stage" {
  description = "Deployment stage (dev, prod, etc.) — names the ECR repo and appears in image tags."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "account_id" {
  description = "AWS account ID (used to construct IAM resource ARNs)."
  type        = string
}

variable "image_retention_count" {
  description = "Keep the last N image tags in ECR; older ones are lifecycle-expired."
  type        = number
  default     = 10
}

# Environment catalog. Kept as a locals block (not a variable) because v1
# semantics are fixed in the plan — extending requires a reviewable PR,
# not a tfvars tweak.
locals {
  environments = {
    "default-public" = {
      description  = "Full public internet outbound; for community-CLI + pip-install workloads."
      network_mode = "PUBLIC"
    }
    "internal-only" = {
      description  = "S3 + DNS + AWS service endpoints only; no public egress."
      network_mode = "SANDBOX"
    }
  }
}

################################################################################
# ECR repository — stage-level base image
################################################################################

resource "aws_ecr_repository" "sandbox_base" {
  name                 = "thinkwork-${var.stage}-sandbox-base"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name    = "thinkwork-${var.stage}-sandbox-base"
    Stage   = var.stage
    Purpose = "agentcore-code-interpreter-base-image"
  }
}

resource "aws_ecr_lifecycle_policy" "sandbox_base" {
  repository = aws_ecr_repository.sandbox_base.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last ${var.image_retention_count} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.image_retention_count
      }
      action = {
        type = "expire"
      }
    }]
  })
}

################################################################################
# IAM policy document — per-tenant trust template
#
# Rendered as a JSON string so the agentcore-admin Lambda (Unit 5) can
# substitute {tenant_id} at CreateRole time. Stored as a terraform output so
# the Lambda reads it from SSM or environment — not hard-coded in the
# Lambda source.
################################################################################

locals {
  tenant_role_trust_policy_template = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })

  # Inline policy template: tenant-wildcard read on the sandbox SM path
  # family. {tenant_id} is substituted at CreateRole time.
  tenant_role_inline_policy_template = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SandboxSecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        # Wildcard over users within the tenant. See T1b residual.
        Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/${var.stage}/sandbox/{tenant_id}/*"
      },
      {
        Sid    = "SandboxCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"
      },
    ]
  })
}

################################################################################
# Outputs
################################################################################

output "ecr_repository_name" {
  description = "Name of the sandbox base image ECR repo."
  value       = aws_ecr_repository.sandbox_base.name
}

output "ecr_repository_url" {
  description = "Full URL of the sandbox base image ECR repo."
  value       = aws_ecr_repository.sandbox_base.repository_url
}

output "environment_ids" {
  description = "Enum of valid sandbox environment identifiers."
  value       = keys(local.environments)
}

output "environments" {
  description = "Full environment metadata (network mode + description) for each sandbox environment."
  value       = local.environments
}

output "tenant_role_trust_policy_template" {
  description = "JSON trust-policy template for per-tenant sandbox IAM roles. Consumer substitutes {tenant_id}."
  value       = local.tenant_role_trust_policy_template
}

output "tenant_role_inline_policy_template" {
  description = "JSON inline-policy template for per-tenant sandbox IAM roles. Consumer substitutes {tenant_id}."
  value       = local.tenant_role_inline_policy_template
}

output "stage" {
  description = "Echo of the stage variable (convenience for downstream modules)."
  value       = var.stage
}
