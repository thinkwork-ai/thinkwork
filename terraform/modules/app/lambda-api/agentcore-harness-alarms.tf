################################################################################
# AgentCore Harness retirement-soak operational gates.
#
# These use native AWS/Lambda metrics so they work on a fresh stage without
# pre-creating or importing implicit log groups. alarm_actions remain empty,
# consistent with the other non-cost operational alarms in this module.
################################################################################

resource "aws_cloudwatch_metric_alarm" "agentcore_harness_runner_errors" {
  count = local.deploy_lambda_handlers && var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-harness-runner-errors"
  alarm_description   = "The AgentCore Harness runner crashed. The turn fails closed and must be reconciled before the retirement soak can pass."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["harness-runner"].function_name
  }
}
resource "aws_cloudwatch_metric_alarm" "agentcore_harness_runner_throttles" {
  count = local.deploy_lambda_handlers && var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-harness-runner-throttles"
  alarm_description   = "AgentCore Harness turns are being throttled before execution; capacity admission or account concurrency is insufficient."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["harness-runner"].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "agentcore_harness_runner_p95" {
  count = local.deploy_lambda_handlers && var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-harness-runner-p95"
  alarm_description   = "AgentCore Harness runner p95 exceeded the 120-second retirement-certification threshold."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 120000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["harness-runner"].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "agentcore_harness_runner_async_age" {
  count = local.deploy_lambda_handlers && var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-harness-runner-async-age"
  alarm_description   = "AgentCore Harness Event invocations waited more than 60 seconds before execution; the runtime path is backlogged."
  namespace           = "AWS/Lambda"
  metric_name         = "AsyncEventAge"
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 60000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["harness-runner"].function_name
  }
}
