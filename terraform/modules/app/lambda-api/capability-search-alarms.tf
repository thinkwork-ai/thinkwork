# THINK-280 U8 — governed capability runtime external-search observability.
#
# The external MCP search facade (/mcp/capabilities) and the confidential
# client_credentials token leg are the LAST rollout stage. These alarms fire
# from AWS/Lambda Errors metrics that EXIST without any log-group management
# (handler crashes, including ones that never reach a log line) — the same
# constraint memory-alarms.tf documents. Log-metric filters over the broker's
# structured replay/policy/readiness/adapter/provider failure codes require the
# /aws/lambda/<function> groups (created only after first invocation) and are a
# coordinated follow-up; until then those failure classes are observable through
# the structured logs + the capability_broker_calls evidence table.
#
# DISABLE PATH: flip `enable_capability_broker = false` (or the tenant/env gate
# CAPABILITY_EXTERNAL_SEARCH_ENABLED). The handler + route stay deployed but
# return an empty, no-data projection, so no new external access is granted —
# while all historical capability_broker_calls / compliance evidence remains
# queryable. These alarms only exist while the broker is enabled.
#
# alarm_actions are intentionally empty (see memory-alarms.tf): operators wire
# an SNS topic when the rollout needs paging.

resource "aws_cloudwatch_metric_alarm" "capability_search_lambda_errors" {
  count = local.deploy_lambda_handlers && var.enable_capability_broker ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-mcp-capability-search-lambda-errors"
  alarm_description   = "mcp-capability-search (external capability search facade) crashed. External hosts see a failed search; no capability data is exposed on error (fail closed). Investigate before continuing the external-search rollout."
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
    FunctionName = aws_lambda_function.handler["mcp-capability-search"].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "capability_oauth_token_errors" {
  count = local.deploy_lambda_handlers && var.enable_capability_broker ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-mcp-oauth-lambda-errors"
  alarm_description   = "mcp-oauth crashed — includes the confidential client_credentials token leg for external capability clients. Token minting failing hard (never issuing on a bad secret is expected + returns 401, not an Error). Investigate credential/DB reachability."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    FunctionName = aws_lambda_function.handler["mcp-oauth"].function_name
  }
}
