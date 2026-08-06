################################################################################
# Aurora Serverless v2 saturation alarms
#
# STATISTIC MATTERS HERE. RDS publishes CPUUtilization from 1-second samples,
# so the `Maximum` statistic over any period reports the single busiest second
# in that period — on Serverless v2 that reads as ~100% essentially forever
# and tells you nothing. An operator chasing "the database is pegged" off the
# Maximum series is chasing an artifact of the sampling rate, not load.
#
# Both alarms below therefore use `Average`, which is the statistic that
# actually tracks sustained saturation:
#   - CPUUtilization  — average CPU across the 5-minute period.
#   - ACUUtilization  — how much of the configured max_capacity ACU ceiling
#                       the cluster is consuming. This is the one that
#                       matters for Serverless v2: sustained high ACU means
#                       the cluster is near its scaling ceiling and the next
#                       load step has nowhere to go.
#
# 3 × 5-minute evaluation periods (15 minutes of sustained pressure) so a
# migration, a backfill, or a burst of agent traffic does not page anyone.
#
# alarm_actions are empty by module convention — this module owns no SNS
# topic, and the app module's only topic is the cost-alert channel (see
# terraform/modules/app/lambda-api/memory-alarms.tf for the same reasoning).
# Operators subscribe a topic when a stage needs paging.
#
# Aurora-only: ACUUtilization does not exist for the rds-postgres dev/test
# engine, and the pairing is what makes these useful, so both are gated on
# local.use_aurora.
################################################################################

resource "aws_cloudwatch_metric_alarm" "aurora_cpu_utilization_high" {
  count = local.use_aurora ? 1 : 0

  alarm_name        = "thinkwork-${var.stage}-db-cpu-utilization-high"
  alarm_description = "Aurora writer instance averaged >${var.cpu_utilization_alarm_threshold}% CPU for 15 minutes. Statistic is Average by design — the Maximum series is ~100% at all times because RDS samples CPU every second."

  namespace   = "AWS/RDS"
  metric_name = "CPUUtilization"
  statistic   = "Average"

  period              = 300
  evaluation_periods  = 3
  threshold           = var.cpu_utilization_alarm_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = aws_rds_cluster_instance.main[0].identifier
  }

  tags = {
    Name = "thinkwork-${var.stage}-db-cpu-utilization-high"
  }
}

resource "aws_cloudwatch_metric_alarm" "aurora_acu_utilization_high" {
  count = local.use_aurora ? 1 : 0

  alarm_description = "Aurora Serverless v2 averaged >${var.acu_utilization_alarm_threshold}% of its max_capacity ACU ceiling for 15 minutes — the cluster is close to having nowhere left to scale. Raise max_capacity or shed load."
  alarm_name        = "thinkwork-${var.stage}-db-acu-utilization-high"

  namespace   = "AWS/RDS"
  metric_name = "ACUUtilization"
  statistic   = "Average"

  period              = 300
  evaluation_periods  = 3
  threshold           = var.acu_utilization_alarm_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = aws_rds_cluster_instance.main[0].identifier
  }

  tags = {
    Name = "thinkwork-${var.stage}-db-acu-utilization-high"
  }
}
