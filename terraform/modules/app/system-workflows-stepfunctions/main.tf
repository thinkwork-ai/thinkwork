################################################################################
# System Workflows Step Functions — App Module (stage-level)
#
# Stage-scoped substrate for ThinkWork-owned operating workflows. Unlike
# Routines, these state machines are not tenant-authored at runtime; they are
# platform-owned definitions exported from the System Workflow registry and
# reviewed in PRs.
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

variable "log_retention_days" {
  description = "CloudWatch log retention for System Workflow state machine executions."
  type        = number
  default     = 30
}

variable "execution_callback_lambda_arn" {
  description = "ARN of the System Workflow execution callback Lambda. Empty keeps EventBridge callback wiring disabled while the runtime callback handler is not deployed."
  type        = string
  default     = ""
}

variable "eval_runner_lambda_arn" {
  description = "ARN of the eval-runner Lambda invoked by the Evaluation Runs System Workflow."
  type        = string
  default     = ""
}

variable "wiki_compile_lambda_arn" {
  description = "ARN of the wiki-compile Lambda invoked by the Wiki Build System Workflow."
  type        = string
  default     = ""
}

locals {
  log_group_name          = "/aws/vendedlogs/states/thinkwork-${var.stage}-system-workflows"
  output_bucket           = "thinkwork-${var.stage}-system-workflow-output"
  role_name               = "thinkwork-${var.stage}-system-workflows-execution-role"
  eval_runner_lambda_arn  = var.eval_runner_lambda_arn != "" ? var.eval_runner_lambda_arn : "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-eval-runner"
  wiki_compile_lambda_arn = var.wiki_compile_lambda_arn != "" ? var.wiki_compile_lambda_arn : "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-wiki-compile"

  standard_state_machines = {
    "wiki-build" = {
      name = "thinkwork-${var.stage}-system-wiki-build"
      definition = templatefile("${path.module}/asl/wiki-build-standard.asl.json", {
        wiki_compile_lambda_arn = local.wiki_compile_lambda_arn
      })
    }
    "evaluation-runs" = {
      name = "thinkwork-${var.stage}-system-evaluation-runs"
      definition = templatefile("${path.module}/asl/evaluation-runs-standard.asl.json", {
        eval_runner_lambda_arn = local.eval_runner_lambda_arn
      })
    }
    "tenant-agent-activation" = {
      name       = "thinkwork-${var.stage}-system-tenant-agent-activation"
      definition = file("${path.module}/asl/tenant-agent-activation-standard.asl.json")
    }
  }
}

resource "aws_cloudwatch_log_group" "system_workflows" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days

  tags = {
    Name    = local.log_group_name
    Stage   = var.stage
    Purpose = "step-functions-system-workflows"
  }
}

resource "aws_s3_bucket" "system_workflow_output" {
  bucket = local.output_bucket

  tags = {
    Name    = local.output_bucket
    Stage   = var.stage
    Purpose = "system-workflow-output"
  }
}

resource "aws_iam_role" "system_workflows_execution" {
  name = local.role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name    = local.role_name
    Stage   = var.stage
    Purpose = "system-workflow-execution"
  }
}

resource "aws_iam_role_policy" "system_workflows_execution" {
  name = "thinkwork-${var.stage}-system-workflows-execution"
  role = aws_iam_role.system_workflows_execution.id

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
          "s3:GetObject",
          "s3:PutObject",
        ]
        Resource = "${aws_s3_bucket.system_workflow_output.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction",
        ]
        Resource = [
          local.eval_runner_lambda_arn,
          local.wiki_compile_lambda_arn,
        ]
      },
    ]
  })
}

resource "aws_sfn_state_machine" "standard" {
  for_each = local.standard_state_machines

  name     = each.value.name
  role_arn = aws_iam_role.system_workflows_execution.arn
  type     = "STANDARD"

  definition = each.value.definition

  logging_configuration {
    include_execution_data = true
    level                  = "ALL"
    log_destination        = "${aws_cloudwatch_log_group.system_workflows.arn}:*"
  }

  tags = {
    Name       = each.value.name
    Stage      = var.stage
    Purpose    = "system-workflow"
    WorkflowId = each.key
  }
}

resource "aws_cloudwatch_event_rule" "sfn_state_change" {
  count       = var.execution_callback_lambda_arn != "" ? 1 : 0
  name        = "thinkwork-${var.stage}-system-workflows-sfn-state-change"
  description = "Forward System Workflow SFN execution state changes to ThinkWork."

  event_pattern = jsonencode({
    source        = ["aws.states"]
    "detail-type" = ["Step Functions Execution Status Change"]
    detail = {
      stateMachineArn = [
        {
          prefix = "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-system-"
        },
      ]
    }
  })

  tags = {
    Name  = "thinkwork-${var.stage}-system-workflows-sfn-state-change"
    Stage = var.stage
  }
}

resource "aws_cloudwatch_event_target" "sfn_state_change" {
  count     = var.execution_callback_lambda_arn != "" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.sfn_state_change[0].name
  target_id = "system-workflow-execution-callback"
  arn       = var.execution_callback_lambda_arn
}

resource "aws_lambda_permission" "sfn_state_change" {
  count         = var.execution_callback_lambda_arn != "" ? 1 : 0
  statement_id  = "AllowEventBridgeInvokeSystemWorkflowExecutionCallback"
  action        = "lambda:InvokeFunction"
  function_name = var.execution_callback_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sfn_state_change[0].arn
}

output "execution_role_arn" {
  description = "System Workflow Step Functions execution role ARN."
  value       = aws_iam_role.system_workflows_execution.arn
}

output "log_group_arn" {
  description = "CloudWatch log group ARN for System Workflow executions."
  value       = aws_cloudwatch_log_group.system_workflows.arn
}

output "output_bucket_name" {
  description = "S3 bucket for System Workflow output artifacts."
  value       = aws_s3_bucket.system_workflow_output.bucket
}

output "standard_state_machine_arns" {
  description = "Standard parent state machine ARNs by System Workflow id."
  value       = { for id, machine in aws_sfn_state_machine.standard : id => machine.arn }
}
