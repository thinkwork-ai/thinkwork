# THINK-193 U8 — external-memory compounding observability.
#
# Alarms here fire from metrics that EXIST without any log-group management:
#   - AWS/Lambda Errors for the memory-stage worker and the retraction drainer
#     (handler crashes, including ones that never reach a log line);
#   - the wiki-compile DLQ depth (the only memory-path Lambda with an
#     on_failure destination).
#
# DELIBERATELY NOT HERE — log-metric filters over the drainer's structured
# summary line and the worker's "status=failed" line. They require the
# /aws/lambda/<function> log groups, which only exist after a function's first
# invocation: PutMetricFilter failed with ResourceNotFoundException on customer
# stages taking a fresh release (dev passed only because its groups already
# existed). Managing the groups in Terraform instead needs a coordinated state
# import on every stage that already has the implicit group, so it is a
# follow-up. Until then, drainer errors / dead-letters and stage failures are
# observable through the structured logs and
# packages/api/scripts/external-memory-readiness.ts (which reports due,
# failed, and dead-lettered attempts directly from the ledger).
#
# Also runbook-only (no metric exists): source checkpoint age, graph-to-wiki
# lag, evidence lag, deferred identity count/age.
#
# alarm_actions are empty: the only SNS topic in this module
# (aws_sns_topic.cost_alerts) is the cost-alert channel — wiring memory alarms
# into it would misroute pages. Operators subscribe a topic when the rollout
# needs paging.


resource "aws_cloudwatch_metric_alarm" "memory_stage_worker_lambda_errors" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-memory-stage-worker-lambda-errors"
  alarm_description   = "memory-stage-worker Lambda crashed (unhandled error, retries pinned to 0, no failure destination) — the parked workflow run will need a redrive."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["memory-stage-worker"].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "memory_retraction_drainer_lambda_errors" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-memory-retraction-drainer-lambda-errors"
  alarm_description   = "memory-retraction-drainer Lambda crashed before emitting its summary line — due retraction work is stalled until the next scheduled tick succeeds."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["memory-retraction-drainer"].function_name
  }
}

# ---------------------------------------------------------------------------
# wiki-compile DLQ depth (graph → wiki handoff failures)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "wiki_compile_dlq_depth" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-wiki-compile-dlq-depth"
  alarm_description   = "wiki-compile DLQ has messages — a compile invocation crashed before the job ledger recorded an outcome; canonical pages are stale until replayed."
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
    QueueName = aws_sqs_queue.wiki_compile_dlq[0].name
  }
}
