################################################################################
# THINK-316 U9 — assertion mint operational gates
#
# The mint emits redacted EMF metrics around only the KMS Sign call. These
# alarms encode the frozen U9 latency and failure thresholds; no assertion,
# subject, tenant, key id, or other caller material is emitted as a dimension.
################################################################################

resource "aws_cloudwatch_metric_alarm" "agentcore_turn_assertion_kms_p95" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-turn-assertion-kms-p95"
  alarm_description   = "AgentCore turn assertion KMS signing p95 exceeded the frozen 100 ms U9 gate."
  namespace           = "ThinkWork/AgentCore"
  metric_name         = "TurnAssertionKmsSignLatency"
  extended_statistic  = "p95"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 100
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    Stage = var.stage
  }
}

resource "aws_cloudwatch_metric_alarm" "agentcore_turn_assertion_kms_p99" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-turn-assertion-kms-p99"
  alarm_description   = "AgentCore turn assertion KMS signing p99 exceeded the frozen 250 ms U9 gate."
  namespace           = "ThinkWork/AgentCore"
  metric_name         = "TurnAssertionKmsSignLatency"
  extended_statistic  = "p99"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 250
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    Stage = var.stage
  }
}

resource "aws_cloudwatch_metric_alarm" "agentcore_turn_assertion_kms_failures" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-turn-assertion-kms-failures"
  alarm_description   = "AgentCore turn assertion KMS signing failed; new Harness/Gateway assertions fail closed."
  namespace           = "ThinkWork/AgentCore"
  metric_name         = "TurnAssertionKmsSignFailures"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    Stage = var.stage
  }
}

resource "aws_cloudwatch_metric_alarm" "agentcore_turn_assertion_lambda_errors" {
  count = var.enable_agentcore_multiplayer_proof ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-agentcore-turn-assertion-errors"
  alarm_description   = "The internal AgentCore assertion mint Lambda failed. No fallback assertion is issued."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["turn-assertion-mint"].function_name
  }
}
