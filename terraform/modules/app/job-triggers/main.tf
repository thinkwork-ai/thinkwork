################################################################################
# Job Triggers — App Module
#
# EventBridge Scheduler + Lambda for routine/scheduled job execution.
# Full implementation ported in Phase 4. Phase 1 creates IAM scaffolding.
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

################################################################################
# IAM Roles
################################################################################

resource "aws_iam_role" "job_trigger_lambda" {
  name = "thinkwork-${var.stage}-job-trigger-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "job_trigger_basic" {
  role       = aws_iam_role.job_trigger_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role" "job_scheduler" {
  name = "thinkwork-${var.stage}-job-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# When job-schedule-manager creates a schedule, it sets this role as the
# target RoleArn. EventBridge Scheduler assumes it and invokes the
# job-trigger Lambda. ARN is constructed by naming convention so this
# module doesn't have to import the lambda-api module's outputs.
resource "aws_iam_role_policy" "job_scheduler_invoke" {
  name = "invoke-job-trigger"
  role = aws_iam_role.job_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      Resource = [
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger",
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger:*",
      ]
    }]
  })
}

################################################################################
# Outputs
################################################################################

output "job_trigger_lambda_role_arn" {
  description = "IAM role ARN for job trigger Lambda"
  value       = aws_iam_role.job_trigger_lambda.arn
}

output "job_scheduler_role_arn" {
  description = "IAM role ARN for EventBridge Scheduler"
  value       = aws_iam_role.job_scheduler.arn
}
