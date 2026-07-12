# THINK-193 U8 — workflow-interpreter execution failure alarms.
#
# Terminal FAILED/TIMED_OUT/ABORTED executions are projected onto the run
# row by workflow-execution-callback (DB, not a parseable log line), so the
# reliable infrastructure signal is the Step Functions service metrics on
# the interpreter state machine itself. Memory workflows (personal +
# shared) execute through this machine — an execution failure here is the
# "workflow-interpreter execution failures" rollout gate signal.
#
# alarm_actions are empty: no paging SNS topic exists in this module.
# Operators subscribe one when the rollout needs paging.

resource "aws_cloudwatch_metric_alarm" "interpreter_executions_failed" {
  alarm_name          = "thinkwork-${var.stage}-workflow-interpreter-executions-failed"
  alarm_description   = "Workflow-interpreter Step Functions executions FAILED — check the run's timeline (workflow_step_failed events) and the execution history."
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.interpreter.arn
  }
}

resource "aws_cloudwatch_metric_alarm" "interpreter_executions_timed_out" {
  alarm_name          = "thinkwork-${var.stage}-workflow-interpreter-executions-timed-out"
  alarm_description   = "Workflow-interpreter Step Functions executions TIMED_OUT — a parked task token (approval / memory stage) was never resolved within the execution timeout."
  namespace           = "AWS/States"
  metric_name         = "ExecutionsTimedOut"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.interpreter.arn
  }
}
