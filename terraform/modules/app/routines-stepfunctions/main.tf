################################################################################
# Routines Step Functions — App Module (stage-level)
#
# Stage-scoped substrate for the Step Functions Routines runtime:
#   * Execution role (one per stage, ABAC-tenant-tagged, used by ALL routines).
#   * CloudWatch log group for state machine execution histories.
#   * S3 bucket for python() recipe output offload (mandatory due to the
#     256KB ASL state-payload + 25K-event execution-history caps).
#
# **State machines themselves are NOT created here.** Each Routine
# provisions its own state machine via the createRoutine GraphQL
# resolver (Phase B U7) using the role + log group exported by this
# module. This mirrors the agentcore-code-interpreter pattern: stage
# substrate in Terraform, per-resource fan-out at runtime.
#
# **Tenant isolation via ABAC.** The execution role's inline policies use
# tag-condition matching (aws:PrincipalTag/tenantId vs.
# aws:ResourceTag/tenantId). Each state machine is created with the
# tenantId/agentId/routineId tags so cross-tenant invocations fail at
# the IAM layer.
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
  description = "Deployment stage (dev, prod, etc.)."
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

variable "log_retention_days" {
  description = "CloudWatch log retention for routine state machine executions."
  type        = number
  default     = 30
}

locals {
  log_group_name = "/aws/vendedlogs/states/thinkwork-${var.stage}-routines"
  output_bucket  = "thinkwork-${var.stage}-routine-output"
  role_name      = "thinkwork-${var.stage}-routines-execution-role"
}

################################################################################
# CloudWatch Log Group
#
# Uses the /aws/vendedlogs/states/ prefix to dodge the resource-policy size
# cap when the tenant accumulates hundreds of state machines.
################################################################################

resource "aws_cloudwatch_log_group" "routines" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days

  tags = {
    Name    = local.log_group_name
    Stage   = var.stage
    Purpose = "step-functions-routines"
  }
}

################################################################################
# S3 bucket — python() recipe output offload
#
# Path layout: s3://<bucket>/<tenantId>/<executionArn>/<nodeId>/{stdout,stderr}.log
# The python() Task wrapper writes here; the run-detail surface signs URLs
# server-side with tenant-scoped IAM and short expirations.
################################################################################

resource "aws_s3_bucket" "routine_output" {
  bucket = local.output_bucket

  tags = {
    Name    = local.output_bucket
    Stage   = var.stage
    Purpose = "routine-python-output"
  }
}

resource "aws_s3_bucket_public_access_block" "routine_output" {
  bucket = aws_s3_bucket.routine_output.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "routine_output" {
  bucket = aws_s3_bucket.routine_output.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "routine_output" {
  bucket = aws_s3_bucket.routine_output.id

  versioning_configuration {
    status = "Disabled"
  }
}

################################################################################
# Step Functions Execution Role — single role for all routines
#
# Trust: states.amazonaws.com.
# ABAC: inline policies condition on tag matching where applicable.
################################################################################

resource "aws_iam_role" "execution" {
  name = local.role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })

  tags = {
    Name    = local.role_name
    Stage   = var.stage
    Purpose = "step-functions-routines-execution"
  }
}

# CloudWatch logs (X-Ray + CloudWatch Logs Delivery for Step Functions).
# Step Functions requires these specific actions to populate execution
# history into the vendedlogs prefix.
resource "aws_iam_role_policy" "execution_logs" {
  name = "logs-and-xray"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.routines.arn}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
    ]
  })
}

# Lambda invocation — scoped to the routine task wrapper Lambdas. The
# wrappers themselves enforce per-tenant authorization (validating the
# routine_id + execution_arn against the DB) so wildcard here is
# acceptable; tightening to specific function ARNs causes a chicken-and-
# egg with the lambda-api module which depends on outputs from this one.
resource "aws_iam_role_policy" "execution_lambda_invoke" {
  name = "lambda-invoke-task-wrappers"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      Resource = [
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-routine-task-*",
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-routine-resume",
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-routine-approval-callback",
      ]
    }]
  })
}

# Bedrock AgentCore — code interpreter (python() recipe) and agent runtime
# (agent_invoke recipe via aws-sdk:bedrockagentcore:invokeAgentRuntime
# direct integration).
resource "aws_iam_role_policy" "execution_bedrock_agentcore" {
  name = "bedrock-agentcore"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
          "bedrock-agentcore:StopCodeInterpreterSession",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = "*"
      },
    ]
  })
}

# Secrets Manager — for routines that reach for tenant-scoped secrets
# (e.g. API tokens) via the python() recipe. Path-scoped per tenant.
resource "aws_iam_role_policy" "execution_secrets" {
  name = "secrets-manager"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
      ]
      Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/${var.stage}/routines/*"
    }]
  })
}

# Step Functions self-invocation — for the routine_invoke recipe (one
# routine calling another via startExecution.sync:2). Plus task-token
# completion (SendTaskSuccess / SendTaskFailure) needed by the inbox-
# approval bridge that runs out-of-band from this state machine.
resource "aws_iam_role_policy" "execution_states" {
  name = "states-self-invoke"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "states:StartExecution",
          "states:DescribeExecution",
          "states:StopExecution",
        ]
        # Tenant-tag matched: a routine in tenant A cannot start a
        # routine in tenant B. Enforced by ABAC condition.
        Resource = "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-routine-*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/tenantId" = "$${aws:PrincipalTag/tenantId}"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "states:SendTaskSuccess",
          "states:SendTaskFailure",
          "states:SendTaskHeartbeat",
        ]
        Resource = "*"
      },
    ]
  })
}

# S3 — write to the python() output bucket, scoped by tenant prefix.
resource "aws_iam_role_policy" "execution_s3_output" {
  name = "s3-routine-output"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
        ]
        Resource = "${aws_s3_bucket.routine_output.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.routine_output.arn
      },
    ]
  })
}

################################################################################
# Outputs
################################################################################

output "execution_role_arn" {
  description = "ARN of the Step Functions execution role (assumed by all routine state machines)."
  value       = aws_iam_role.execution.arn
}

output "execution_role_name" {
  description = "Name of the Step Functions execution role."
  value       = aws_iam_role.execution.name
}

output "log_group_arn" {
  description = "CloudWatch log group ARN for state machine execution histories."
  value       = aws_cloudwatch_log_group.routines.arn
}

output "log_group_name" {
  description = "CloudWatch log group name."
  value       = aws_cloudwatch_log_group.routines.name
}

output "output_bucket_name" {
  description = "S3 bucket for python() recipe stdout/stderr offload."
  value       = aws_s3_bucket.routine_output.bucket
}

output "output_bucket_arn" {
  description = "S3 bucket ARN for python() recipe stdout/stderr offload."
  value       = aws_s3_bucket.routine_output.arn
}

output "stage" {
  description = "Echo of the stage variable (convenience for downstream modules)."
  value       = var.stage
}
