################################################################################
# THINK-915 — chat turn-latency observability (metrics, dashboard, alarm,
# saved Logs Insights query).
#
# WHY: a 52 s turn shipped with a hidden ~20-24 s AgentCore cold start (the gap
# between `api.runtime_dispatch.invoke` starting and the container's
# `runtime.invocation.received`). Nothing alarmed; a human noticed. Every chat
# turn already emits structured `agentcore_phase` lines, but they were only
# reachable through ad-hoc Logs Insights runs (scripts/latency-dashboard.sh).
# This file turns two of those phases into real CloudWatch metrics, puts them on
# a per-stage dashboard next to the Lambda-native signals, and alarms on the
# p95 of the whole runtime call.
#
# ── Phase lines and where they land ──────────────────────────────────────────
#   api.agentcore.dispatch        chat-agent-invoke            /aws/lambda/thinkwork-<stage>-api-chat-agent-invoke
#   api.runtime_dispatch.invoke   agentcore-runtime-dispatch   /aws/lambda/thinkwork-<stage>-api-agentcore-runtime-dispatch
#   api.finalize.process          chat-agent-finalize          /aws/lambda/thinkwork-<stage>-api-chat-agent-finalize
#   runtime.*                     Pi container                 /aws/bedrock-agentcore/runtimes/thinkwork_<stage>_pi-<id>-DEFAULT
#
# ── Constraint 1: JSON filter patterns need whole-line JSON ──────────────────
# CloudWatch metric filters only apply a JSON filter pattern (`{ $.event = … }`)
# to log events that parse as JSON end to end. The Node Lambda runtime prefixes
# `console.*` output with `<timestamp>\t<requestId>\tINFO\t…`, which is not
# valid JSON — so the Lambda-side phase lines were unusable by metric filters
# even though Logs Insights tolerates the prefix. THINK-915 therefore switched
# packages/api/src/lib/agentcore-phase-log.ts to write the record straight to
# `process.stdout` (the Pi container emitter has always done this), which
# reaches CloudWatch unprefixed. Nothing else about the record changed, so the
# existing Logs Insights queries keep working.
#
# ── Constraint 2: metric-filter dimensions must be JSON references ───────────
# `metric_transformation.dimensions` values may only be `$.field` references
# into the matched log event — a literal `Stage = var.stage` (as used by the
# PutMetricData-sourced Thinkwork/Costs alarms) is rejected. The phase record
# carries no stage field, so the stage is carried in the namespace instead:
# `Thinkwork/Chat/<stage>`. Same isolation, no emitter change.
#
# ── Constraint 3: implicit log groups ────────────────────────────────────────
# The API handler log groups are created implicitly by Lambda on first
# invocation and are NOT Terraform-managed (see memory-alarms.tf: adding metric
# filters over them broke greenfield applies with ResourceNotFoundException).
# So the metric filters — and the alarm that depends on one of them — are gated
# behind `enable_chat_turn_latency_metric_filters`, default OFF. Flip it on for
# a stage that has already served chat traffic. The dashboard, the Lambda-native
# alarm, and the saved query have no such dependency and are on by default.
#
# ── Constraint 4: the runtime log group name contains a generated id ─────────
# The AgentCore runtime log group is `/aws/bedrock-agentcore/runtimes/
# thinkwork_<stage>_pi-<runtimeId>-DEFAULT`, and the runtime is reconciled by
# scripts/post-deploy.sh (runtime id in SSM), not by Terraform — so no resource
# here knows the name. It is supplied explicitly via
# `chat_turn_runtime_log_group_name` (see the revised note in locals below —
# plan-time prefix discovery broke customer deployment-runner plans). While it
# is unset the runtime-sourced pieces (AgentLoopMs filter, its dashboard
# widgets, that leg of the saved query) are simply skipped.
################################################################################

locals {
  chat_latency_enabled = local.deploy_lambda_handlers && var.enable_chat_turn_latency_observability

  # See constraint 2 — the stage lives in the namespace, not a dimension.
  chat_latency_namespace = "${var.chat_turn_latency_metric_namespace}/${var.stage}"

  chat_latency_dispatch_fn = local.chat_latency_enabled ? aws_lambda_function.handler["agentcore-runtime-dispatch"].function_name : ""
  chat_latency_invoke_fn   = local.chat_latency_enabled ? aws_lambda_function.handler["chat-agent-invoke"].function_name : ""
  chat_latency_finalize_fn = local.chat_latency_enabled ? aws_lambda_function.handler["chat-agent-finalize"].function_name : ""
  chat_latency_graphql_fn  = local.chat_latency_enabled ? aws_lambda_function.handler["graphql-http"].function_name : ""

  # The four Lambdas a chat turn passes through, in turn order.
  chat_latency_functions = local.chat_latency_enabled ? [
    local.chat_latency_graphql_fn,
    local.chat_latency_invoke_fn,
    local.chat_latency_dispatch_fn,
    local.chat_latency_finalize_fn,
  ] : []

  chat_latency_lambda_log_groups = [for fn in local.chat_latency_functions : "/aws/lambda/${fn}"]

  # Constraint 4, revised after the canary.467/468 mcpherson deploys: the
  # runtime log group comes ONLY from the explicit variable. The prefix
  # discovery data source (aws_cloudwatch_log_groups) defers to apply in the
  # customer deployment-runner flow, and the resulting unknown value first
  # broke a count ("Invalid count argument") and then, once the count was
  # fixed, broke the dashboard-widget conditionals ("Inconsistent conditional
  # result types" — an unknown condition forces both arms of every dependent
  # conditional to unify to one type, which heterogeneous widget objects
  # cannot). A plan-known variable sidesteps the whole class. When it is
  # empty, the runtime-sourced pieces (AgentLoopMs filter, runtime widgets,
  # that leg of the saved query) are skipped; set it per stage once the
  # runtime exists:
  #   /aws/bedrock-agentcore/runtimes/thinkwork_<stage>_pi-<runtimeId>-DEFAULT
  chat_latency_runtime_log_group = var.chat_turn_runtime_log_group_name

  chat_latency_has_runtime_log_group = local.chat_latency_runtime_log_group != ""

  chat_latency_metric_filters_enabled = local.chat_latency_enabled && var.enable_chat_turn_latency_metric_filters
}

################################################################################
# Metric filters
################################################################################

# Whole-runtime-call latency: the dispatcher measures from just before
# InvokeAgentRuntime to the fully drained response, so this number INCLUDES the
# AgentCore cold start that the 52 s incident hid. Only `completed` lines feed
# it — a `failed` line's durationMs is time-to-error, not turn latency.
resource "aws_cloudwatch_log_metric_filter" "turn_runtime_invoke_ms" {
  count = local.chat_latency_metric_filters_enabled ? 1 : 0

  name           = "thinkwork-${var.stage}-turn-runtime-invoke-ms"
  log_group_name = "/aws/lambda/${local.chat_latency_dispatch_fn}"
  pattern        = "{ $.event = \"agentcore_phase\" && $.phase = \"api.runtime_dispatch.invoke\" && $.status = \"completed\" && $.durationMs = * }"

  metric_transformation {
    name      = "TurnRuntimeInvokeMs"
    namespace = local.chat_latency_namespace
    value     = "$.durationMs"
    unit      = "Milliseconds"
    # No default_value: a period with no turns must stay a gap, not a 0 ms turn
    # that would drag the percentiles down and mask a regression.
  }
}

# Model-loop latency from inside the container. Subtracting this from
# TurnRuntimeInvokeMs is the cold-start / harness-overhead signal (see the
# dashboard's "runtime overhead" widget).
#
# count gates on VARIABLES ONLY — never on the prefix discovery. In the
# customer deployment-runner flow the aws_cloudwatch_log_groups data source
# defers to apply, so a count that reads local.chat_latency_has_runtime_log_group
# fails the whole plan with "Invalid count argument" (canary.467 mcpherson
# deploy, 2026-08-20). The runtime-side filter therefore requires the explicit
# chat_turn_runtime_log_group_name override; discovery still feeds the
# dashboard widgets and saved query, whose bodies tolerate unknown values.
resource "aws_cloudwatch_log_metric_filter" "agent_loop_ms" {
  count = local.chat_latency_metric_filters_enabled && var.chat_turn_runtime_log_group_name != "" ? 1 : 0

  name           = "thinkwork-${var.stage}-agent-loop-ms"
  log_group_name = var.chat_turn_runtime_log_group_name
  pattern        = "{ $.event = \"agentcore_phase\" && $.phase = \"runtime.agent_loop\" && $.status = \"completed\" && $.durationMs = * }"

  metric_transformation {
    name      = "AgentLoopMs"
    namespace = local.chat_latency_namespace
    value     = "$.durationMs"
    unit      = "Milliseconds"
  }
}

################################################################################
# Alarms
#
# alarm_actions default to [] — consistent with memory-alarms.tf and
# capability-search-alarms.tf. The only SNS topic in this module
# (aws_sns_topic.cost_alerts) is the cost-alert channel and wiring latency
# pages into it would misroute them. Pass `chat_turn_latency_alarm_actions`
# (and `..._ok_actions`) once a stage has a topic worth paging.
################################################################################

resource "aws_cloudwatch_metric_alarm" "chat_turn_runtime_invoke_p95" {
  count = local.chat_latency_metric_filters_enabled ? 1 : 0

  alarm_name        = "thinkwork-${var.stage}-chat-turn-runtime-invoke-p95"
  alarm_description = "p95 of api.runtime_dispatch.invoke (the whole AgentCore runtime call, cold start included) exceeded ${var.chat_turn_p95_alarm_threshold_ms} ms in 2 of the last 3 five-minute periods. This is the regression guard for the 2026-08 incident where a 52 s turn hid a ~20-24 s cold start."

  namespace           = local.chat_latency_namespace
  metric_name         = "TurnRuntimeInvokeMs"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = var.chat_turn_p95_alarm_threshold_ms
  comparison_operator = "GreaterThanThreshold"
  # Idle stages emit no turns at all; missing data is not a latency problem.
  treat_missing_data = "notBreaching"

  alarm_actions = var.chat_turn_latency_alarm_actions
  ok_actions    = var.chat_turn_latency_alarm_actions
}

# Log-group-independent companion: the dispatcher's whole job is the runtime
# call, so its Lambda Duration tracks TurnRuntimeInvokeMs closely. This alarm
# needs no metric filter, so it protects stages that have not (or cannot yet)
# turn the filters on.
resource "aws_cloudwatch_metric_alarm" "chat_dispatch_duration_p95" {
  count = local.chat_latency_enabled ? 1 : 0

  alarm_name        = "thinkwork-${var.stage}-chat-dispatch-duration-p95"
  alarm_description = "p95 agentcore-runtime-dispatch Lambda Duration exceeded ${var.chat_turn_p95_alarm_threshold_ms} ms in 2 of the last 3 five-minute periods. Native-metric stand-in for TurnRuntimeInvokeMs (the dispatcher does nothing but the runtime call), so it fires even where the log metric filters are off."

  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = var.chat_turn_p95_alarm_threshold_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.chat_turn_latency_alarm_actions
  ok_actions    = var.chat_turn_latency_alarm_actions

  dimensions = {
    FunctionName = local.chat_latency_dispatch_fn
  }
}

################################################################################
# Dashboard
################################################################################

locals {
  chat_latency_dashboard_region = var.region

  chat_latency_widgets = local.chat_latency_enabled ? concat(
    [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 3
        properties = {
          markdown = join("\n", [
            "## Chat turn latency — ${var.stage}",
            "",
            "Turn path: **graphql-http** (sendMessage) → **chat-agent-invoke** (setup) → **agentcore-runtime-dispatch** → **AgentCore Runtime (Pi)** → **chat-agent-finalize**.",
            "",
            local.chat_latency_metric_filters_enabled ? "Phase metrics come from `agentcore_phase` log metric filters in `${local.chat_latency_namespace}`." : "**Phase metrics are OFF for this stage** (`enable_chat_turn_latency_metric_filters = false`) — the phase widgets stay empty. Lambda-native widgets below still populate.",
            local.chat_latency_has_runtime_log_group ? "Runtime log group: `${local.chat_latency_runtime_log_group}`." : "**AgentCore runtime log group not configured** — set `chat_turn_runtime_log_group_name` to light up `AgentLoopMs` and the runtime-overhead widget.",
            "",
            "Timeline for a single turn: Logs Insights → saved query **thinkwork-${var.stage}-turn-timeline** (paste a `threadTurnId`).",
          ])
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 3
        width  = 12
        height = 6
        properties = {
          title  = "Whole runtime call — api.runtime_dispatch.invoke (ms)"
          region = local.chat_latency_dashboard_region
          view   = "timeSeries"
          stat   = "p50"
          period = 300
          metrics = [
            [local.chat_latency_namespace, "TurnRuntimeInvokeMs", { stat = "p50", label = "p50" }],
            ["...", { stat = "p95", label = "p95" }],
          ]
          yAxis = { left = { label = "ms", showUnits = false } }
          annotations = {
            horizontal = [{
              label = "p95 alarm threshold"
              value = var.chat_turn_p95_alarm_threshold_ms
            }]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 3
        width  = 12
        height = 6
        properties = {
          title  = "Model loop — runtime.agent_loop (ms)"
          region = local.chat_latency_dashboard_region
          view   = "timeSeries"
          stat   = "p50"
          period = 300
          metrics = [
            [local.chat_latency_namespace, "AgentLoopMs", { stat = "p50", label = "p50" }],
            ["...", { stat = "p95", label = "p95" }],
          ]
          yAxis = { left = { label = "ms", showUnits = false } }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 9
        width  = 12
        height = 6
        properties = {
          title  = "Runtime overhead p95 (invoke − agent_loop) — cold start lives here"
          region = local.chat_latency_dashboard_region
          view   = "timeSeries"
          period = 300
          metrics = [
            [{ expression = "invoke - loop", label = "overhead p95 (ms)", id = "overhead" }],
            [local.chat_latency_namespace, "TurnRuntimeInvokeMs", { stat = "p95", id = "invoke", visible = false }],
            [local.chat_latency_namespace, "AgentLoopMs", { stat = "p95", id = "loop", visible = false }],
          ]
          yAxis = { left = { label = "ms", showUnits = false } }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 9
        width  = 12
        height = 6
        properties = {
          title  = "agentcore-runtime-dispatch Lambda Duration p95 (ms)"
          region = local.chat_latency_dashboard_region
          view   = "timeSeries"
          period = 300
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", local.chat_latency_dispatch_fn, { stat = "p95", label = "p95" }],
            ["...", { stat = "Maximum", label = "max" }],
          ]
          yAxis = { left = { label = "ms", showUnits = false } }
          annotations = {
            horizontal = [{
              label = "p95 alarm threshold"
              value = var.chat_turn_p95_alarm_threshold_ms
            }]
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 15
        width  = 12
        height = 6
        properties = {
          title  = "Invocations (Sum) — turn path Lambdas"
          region = local.chat_latency_dashboard_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            for fn in local.chat_latency_functions :
            ["AWS/Lambda", "Invocations", "FunctionName", fn, { label = fn }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 15
        width  = 12
        height = 6
        properties = {
          title  = "Errors (Sum) — turn path Lambdas"
          region = local.chat_latency_dashboard_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            for fn in local.chat_latency_functions :
            ["AWS/Lambda", "Errors", "FunctionName", fn, { label = fn }]
          ]
        }
      },
    ],
    local.chat_latency_has_runtime_log_group ? [
      {
        type   = "log"
        x      = 0
        y      = 21
        width  = 24
        height = 6
        properties = {
          title  = "Slowest turns (last 3h) — runtime call vs model loop"
          region = local.chat_latency_dashboard_region
          view   = "table"
          query  = <<-EOT
            SOURCE '${local.chat_latency_runtime_log_group}'
            | fields ts, phase, durationMs, sessionId, threadTurnId
            | filter event = "agentcore_phase" and status = "completed" and phase = "runtime.agent_loop"
            | sort durationMs desc
            | limit 20
          EOT
        }
      },
    ] : [],
  ) : []
}

resource "aws_cloudwatch_dashboard" "chat_turn_latency" {
  count = local.chat_latency_enabled ? 1 : 0

  dashboard_name = "thinkwork-${var.stage}-chat-turn-latency"
  dashboard_body = jsonencode({ widgets = local.chat_latency_widgets })
}

################################################################################
# Saved Logs Insights query — one turn's timeline across every log group
#
# Usage: open the query, replace REPLACE_WITH_THREAD_TURN_ID, run. `sessionId`
# is matched alongside `threadTurnId` because the container sets sessionId =
# threadTurnId and some early-turn API lines carry only one of the two.
################################################################################

resource "aws_cloudwatch_query_definition" "turn_timeline" {
  count = local.chat_latency_enabled ? 1 : 0

  name = "thinkwork-${var.stage}-turn-timeline"

  log_group_names = local.chat_latency_has_runtime_log_group ? concat(
    local.chat_latency_lambda_log_groups,
    [local.chat_latency_runtime_log_group],
  ) : local.chat_latency_lambda_log_groups

  query_string = <<-EOT
    fields ts, @log, source, phase, status, durationMs, detail, errorType, threadTurnId, sessionId
    | filter event = "agentcore_phase"
    | filter threadTurnId = "REPLACE_WITH_THREAD_TURN_ID" or sessionId = "REPLACE_WITH_THREAD_TURN_ID"
    | sort ts asc
    | limit 500
  EOT
}
