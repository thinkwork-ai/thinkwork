# ---------------------------------------------------------------------------
# Evals per-case fan-out substrate
#
# eval-runner dispatches one message per test case. eval-worker catches
# application-level case failures and writes eval_results.status='error';
# infrastructure failures redrive through SQS to the DLQ after maxReceiveCount=3.
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "eval_fanout_dlq" {
  count                     = local.use_local_zips ? 1 : 0
  name                      = "thinkwork-${var.stage}-eval-fanout-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true

  tags = {
    Name = "thinkwork-${var.stage}-eval-fanout-dlq"
  }
}

resource "aws_sqs_queue" "eval_fanout" {
  count                      = local.use_local_zips ? 1 : 0
  name                       = "thinkwork-${var.stage}-eval-fanout"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400 # 1 day; DLQ holds longer-stuck messages
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.eval_fanout_dlq[0].arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "thinkwork-${var.stage}-eval-fanout"
  }
}

resource "aws_iam_role_policy" "eval_fanout_send" {
  count = local.use_local_zips ? 1 : 0
  name  = "eval-fanout-send"
  role  = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "EvalRunnerSendFanoutMessages"
      Effect = "Allow"
      Action = [
        "sqs:SendMessage",
        "sqs:SendMessageBatch",
      ]
      Resource = aws_sqs_queue.eval_fanout[0].arn
    }]
  })
}

resource "aws_iam_role_policy" "eval_worker_sqs" {
  count = local.use_local_zips ? 1 : 0
  name  = "eval-worker-sqs"
  role  = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EvalWorkerReceiveFanoutMessages"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = aws_sqs_queue.eval_fanout[0].arn
      },
      {
        Sid      = "EvalWorkerSendDlqMessages"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.eval_fanout_dlq[0].arn
      },
    ]
  })
}

resource "aws_lambda_event_source_mapping" "eval_fanout" {
  count = local.use_local_zips ? 1 : 0

  event_source_arn        = aws_sqs_queue.eval_fanout[0].arn
  function_name           = aws_lambda_function.handler["eval-worker"].function_name
  batch_size              = 1
  enabled                 = true
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_function_event_invoke_config" "eval_worker" {
  count = local.use_local_zips ? 1 : 0

  function_name                = aws_lambda_function.handler["eval-worker"].function_name
  maximum_event_age_in_seconds = 3600
  maximum_retry_attempts       = 0
}

resource "aws_cloudwatch_metric_alarm" "eval_fanout_dlq_depth" {
  count = local.use_local_zips ? 1 : 0

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
