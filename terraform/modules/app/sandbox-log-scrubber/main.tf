################################################################################
# Sandbox Log Scrubber — App Module
#
# Secondary (backstop) R13 layer for the AgentCore Code Interpreter sandbox
# (plan Unit 12). Pattern-redacts known-shape OAuth tokens in AgentCore
# APPLICATION_LOGS before they land in the long-term CloudWatch tier.
#
# **This is not the primary R13 layer.** The primary layer is the base-image
# sitecustomize.py stdio wrapper (plan Unit 4, terraform/modules/app/
# agentcore-code-interpreter) which redacts by *value* using the session-
# scoped token set. That layer can catch any token the preamble registered,
# regardless of shape.
#
# This backstop redacts by *pattern* — Authorization: Bearer, JWTs, and
# known OAuth prefixes (gh[opsru]_, xox[abep]-, ya29.). It does not have
# access to session token values so it cannot catch arbitrary leaks. It
# exists to mitigate stdio-bypass classes (subprocess env dumps, os.write,
# C-extension direct writes, multiprocessing workers) whose bytes carry a
# recognizable token prefix.
#
# If the scrubber Lambda fails, source log events remain in the original
# CloudWatch group. S3 tier is delayed, data is not lost.
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
  description = "AWS account ID."
  type        = string
}

variable "source_log_group_name" {
  description = "Source CloudWatch log group to subscribe to. Typically the AgentCore runtime group, e.g. /aws/bedrock-agentcore/runtimes/<runtime-name>."
  type        = string
}

variable "lambda_zip_path" {
  description = "Path to the built Lambda zip. Produced by scripts/build-lambdas.sh sandbox-log-scrubber."
  type        = string
}

variable "lambda_zip_hash" {
  description = "source_code_hash (base64 SHA-256) for the Lambda zip. Triggers function update when the bundle changes."
  type        = string
  default     = ""
}

variable "retention_days" {
  description = "CloudWatch retention on the scrubbed output log group. Matches standard runtime retention."
  type        = number
  default     = 90
}

################################################################################
# Output log group — where scrubbed events land
################################################################################

resource "aws_cloudwatch_log_group" "scrubbed" {
  name              = "/thinkwork/${var.stage}/sandbox/scrubbed"
  retention_in_days = var.retention_days

  tags = {
    Stage   = var.stage
    Purpose = "sandbox-log-scrubber-output"
  }
}

################################################################################
# Lambda execution role + policy
################################################################################

resource "aws_iam_role" "scrubber" {
  name = "thinkwork-${var.stage}-sandbox-log-scrubber"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scrubber" {
  name = "sandbox-log-scrubber"
  role = aws_iam_role.scrubber.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteScrubbedEvents"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ]
        Resource = [
          aws_cloudwatch_log_group.scrubbed.arn,
          "${aws_cloudwatch_log_group.scrubbed.arn}:*",
        ]
      },
      {
        # Lambda's own execution logs (separate group managed by AWS).
        Sid    = "SelfLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/thinkwork-${var.stage}-sandbox-log-scrubber:*"
      },
    ]
  })
}

################################################################################
# Lambda function
################################################################################

resource "aws_lambda_function" "scrubber" {
  function_name    = "thinkwork-${var.stage}-sandbox-log-scrubber"
  role             = aws_iam_role.scrubber.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = var.lambda_zip_path
  source_code_hash = var.lambda_zip_hash
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      OUTPUT_LOG_GROUP = aws_cloudwatch_log_group.scrubbed.name
    }
  }

  tags = {
    Stage   = var.stage
    Purpose = "sandbox-log-scrubber"
  }
}

resource "aws_lambda_permission" "allow_cloudwatch" {
  statement_id  = "AllowExecutionFromCloudWatchLogs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scrubber.function_name
  principal     = "logs.${var.region}.amazonaws.com"
  source_arn    = "arn:aws:logs:${var.region}:${var.account_id}:log-group:${var.source_log_group_name}:*"
}

################################################################################
# Subscription filter — fan source events into the Lambda
################################################################################

resource "aws_cloudwatch_log_subscription_filter" "source" {
  name            = "thinkwork-${var.stage}-sandbox-scrubber"
  log_group_name  = var.source_log_group_name
  filter_pattern  = "" # deliver every event; the Lambda decides
  destination_arn = aws_lambda_function.scrubber.arn
  depends_on      = [aws_lambda_permission.allow_cloudwatch]
}

################################################################################
# Outputs
################################################################################

output "scrubbed_log_group_name" {
  description = "CloudWatch log group receiving scrubbed events."
  value       = aws_cloudwatch_log_group.scrubbed.name
}

output "scrubber_function_name" {
  description = "Scrubber Lambda function name."
  value       = aws_lambda_function.scrubber.function_name
}

output "scrubber_role_arn" {
  description = "Execution role ARN."
  value       = aws_iam_role.scrubber.arn
}
