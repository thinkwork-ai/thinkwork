################################################################################
# Crons — App Module
#
# Scheduled jobs and event-driven processors. Full implementation ported
# in Phase 4. Phase 1 creates the IAM role and a placeholder cron only.
#
# v1 scope: standard crons + wakeup processor.
# Cut: kg_extract_fanout, kg_extract_worker, span_enrichment (PRD-41B).
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
# Shared IAM Role for Cron Lambdas
################################################################################

resource "aws_iam_role" "cron_lambda" {
  name = "thinkwork-${var.stage}-cron-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cron_basic" {
  role       = aws_iam_role.cron_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

################################################################################
# Outputs
################################################################################

output "cron_lambda_role_arn" {
  description = "IAM role ARN for cron Lambda functions"
  value       = aws_iam_role.cron_lambda.arn
}
