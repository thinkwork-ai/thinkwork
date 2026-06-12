# ---------------------------------------------------------------------------
# Evals per-case fan-out substrate
#
# eval-runner dispatches one message per test case. eval-worker catches
# application-level case failures and writes eval_results.status='error'
# (with an error_cause); throttling errors redrive through SQS within the
# redrive budget below. On the final receive the worker records
# error/throttle instead of rethrowing, so the DLQ only sees messages from
# crashes that prevented any result write.
# ---------------------------------------------------------------------------

locals {
  # Single source of truth for the fan-out retry budget. Feeds BOTH the
  # queue's redrive policy maxReceiveCount AND the eval-worker's
  # EVAL_FANOUT_MAX_RECEIVE_COUNT env var (handlers.tf), so the worker's
  # final-receive detection can never drift from the queue's actual
  # redrive behavior.
  eval_fanout_max_receive_count = 5
}

resource "aws_sqs_queue" "eval_fanout_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-eval-fanout-dlq.fifo"
  fifo_queue                = true
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true

  tags = {
    Name = "thinkwork-${var.stage}-eval-fanout-dlq.fifo"
  }
}

resource "aws_sqs_queue" "eval_fanout" {
  count                       = local.deploy_lambda_handlers ? 1 : 0
  name                        = "thinkwork-${var.stage}-eval-fanout.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 300
  message_retention_seconds   = 86400 # 1 day; DLQ holds longer-stuck messages
  sqs_managed_sse_enabled     = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.eval_fanout_dlq[0].arn
    maxReceiveCount     = local.eval_fanout_max_receive_count
  })

  tags = {
    Name = "thinkwork-${var.stage}-eval-fanout.fifo"
  }
}

# The shared-role eval-fanout SQS grants (send + worker receive/DLQ) moved to
# aws_iam_policy.api_data_plane in iam-grouped.tf (R9).

resource "aws_lambda_event_source_mapping" "eval_fanout" {
  count = local.deploy_lambda_handlers ? 1 : 0

  event_source_arn        = aws_sqs_queue.eval_fanout[0].arn
  function_name           = aws_lambda_function.handler["eval-worker"].function_name
  batch_size              = 1
  enabled                 = true
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 20
  }
}

resource "aws_lambda_function_event_invoke_config" "eval_worker" {
  count = local.deploy_lambda_handlers ? 1 : 0

  function_name                = aws_lambda_function.handler["eval-worker"].function_name
  maximum_event_age_in_seconds = 3600
  maximum_retry_attempts       = 0
}

resource "aws_cloudwatch_metric_alarm" "eval_fanout_dlq_depth" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-eval-fanout-dlq-depth"
  alarm_description   = "Eval fan-out DLQ has messages — eval-worker crashed before recording a case result; operator must inspect."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    QueueName = aws_sqs_queue.eval_fanout_dlq[0].name
  }
}
