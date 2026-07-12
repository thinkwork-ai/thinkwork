# THINK-193 U8 — external-memory compounding observability.
#
# Alarms here fire from EXISTING signals only:
#   - the memory-retraction-drainer's structured JSON summary line
#     ({"metric":"memory_retraction_drainer","errors":N,"deadLettered":N,...},
#     packages/api/src/handlers/memory-retraction-drainer.ts);
#   - the memory-stage-worker's per-invocation completion line
#     ("[memory-stage-worker] stage=... status=failed ...");
#   - AWS/Lambda Errors (handler crashes that never reach a log line);
#   - the wiki-compile DLQ (the only memory-path Lambda with an on_failure
#     destination; memory-stage-worker and memory-retraction-drainer pin
#     retries to 0 WITHOUT a destination, so there is no DLQ to watch —
#     their failure signal is the alarms below).
#
# Deliberately NOT alarms (operational runbook via
# packages/api/scripts/external-memory-readiness.ts instead — no metric
# exists and the plan prefers log-metric-filters over new instrumentation):
#   - source checkpoint age (memory_source_checkpoints.last_advanced_at);
#   - graph-to-wiki lag (wiki.compile_jobs pending-age; no completion log
#     line is emitted today);
#   - evidence lag / deferred identity count-and-age (DB-only signals).
#
# alarm_actions are empty: the only SNS topic in this module
# (aws_sns_topic.cost_alerts) is the cost-alert channel — wiring memory
# alarms into it would misroute pages. Operators subscribe a topic when the
# rollout needs paging.
#
# NOTE: the log groups referenced below are the Lambda-implicit
# /aws/lambda/<function> groups, created on first invocation. The drainer is
# on a rate(5 minutes) schedule, so both groups exist on any stack that has
# been live for minutes; on a brand-new stack apply this file after first
# invocations (or re-apply).

locals {
  memory_drainer_log_group      = "/aws/lambda/thinkwork-${var.stage}-api-memory-retraction-drainer"
  memory_stage_worker_log_group = "/aws/lambda/thinkwork-${var.stage}-api-memory-stage-worker"
}

# ---------------------------------------------------------------------------
# memory-retraction-drainer structured summary → metrics
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "memory_retraction_drainer_errors" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name           = "thinkwork-${var.stage}-memory-retraction-drainer-errors"
  log_group_name = local.memory_drainer_log_group
  pattern        = "{ $.metric = \"memory_retraction_drainer\" }"

  metric_transformation {
    name          = "MemoryRetractionDrainerErrors"
    namespace     = "Thinkwork/Memory"
    value         = "$.errors"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "memory_retraction_drainer_dead_lettered" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name           = "thinkwork-${var.stage}-memory-retraction-drainer-dead-lettered"
  log_group_name = local.memory_drainer_log_group
  pattern        = "{ $.metric = \"memory_retraction_drainer\" }"

  metric_transformation {
    name          = "MemoryRetractionDrainerDeadLettered"
    namespace     = "Thinkwork/Memory"
    value         = "$.deadLettered"
    default_value = "0"
  }
}

# Any caught per-attempt error in a drainer tick. Retries usually clear
# these (quadratic backoff), so one datapoint is informational — but errors
# are the leading indicator for dead-letters, so surface immediately.
resource "aws_cloudwatch_metric_alarm" "memory_retraction_drainer_errors" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-memory-retraction-drainer-errors"
  alarm_description   = "memory-retraction-drainer recorded per-attempt errors (retraction saga steps failing; will back off and retry — investigate before they dead-letter)."
  namespace           = "Thinkwork/Memory"
  metric_name         = "MemoryRetractionDrainerErrors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [] # see header — no memory paging channel yet
}

# Sustained dead-letters: a retraction/erase attempt exhausted its budget.
# Requires operator action (retryMemoryRetractionAttempt) — data the tenant
# asked to remove may still be recallable.
resource "aws_cloudwatch_metric_alarm" "memory_retraction_drainer_dead_lettered" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-memory-retraction-drainer-dead-lettered"
  alarm_description   = "memory-retraction-drainer dead-lettered retraction/erase attempts across 3 consecutive ticks — operator must inspect and requeue (retraction may be incomplete)."
  namespace           = "Thinkwork/Memory"
  metric_name         = "MemoryRetractionDrainerDeadLettered"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
}

# ---------------------------------------------------------------------------
# memory-stage-worker failures
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "memory_stage_worker_failed" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name           = "thinkwork-${var.stage}-memory-stage-worker-failed"
  log_group_name = local.memory_stage_worker_log_group
  # Term match on the worker's completion line:
  #   [memory-stage-worker] stage=<s> run=<id> status=failed resume=<r> ...
  pattern = "\"[memory-stage-worker]\" \"status=failed\""

  metric_transformation {
    name          = "MemoryStageWorkerFailed"
    namespace     = "Thinkwork/Memory"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "memory_stage_worker_failed" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-memory-stage-worker-failed"
  alarm_description   = "memory-stage-worker completed a stage with status=failed — the workflow run's memory stage will surface the error; check the run ledger (memory_run_items) for the failing source/items."
  namespace           = "Thinkwork/Memory"
  metric_name         = "MemoryStageWorkerFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
}

# Crash coverage: an unhandled throw never reaches the completion line, and
# with maximum_retry_attempts = 0 and no on_failure destination the event is
# dropped — AWS/Lambda Errors is the only signal.
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
