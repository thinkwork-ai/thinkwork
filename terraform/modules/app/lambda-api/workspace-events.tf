locals {
  workspace_event_enabled = var.enable_workspace_orchestration && local.use_local_zips
  workspace_event_patterns = {
    inbox = [
      "tenants/*/agents/*/workspace/work/inbox/*.md",
      "tenants/*/agents/*/workspace/*/work/inbox/*.md",
    ]
    run_events = [
      "tenants/*/agents/*/workspace/work/runs/*/events/*.json",
      "tenants/*/agents/*/workspace/*/work/runs/*/events/*.json",
    ]
    outbox = [
      "tenants/*/agents/*/workspace/work/outbox/*",
      "tenants/*/agents/*/workspace/*/work/outbox/*",
    ]
    memory = [
      "tenants/*/agents/*/workspace/memory/*",
      "tenants/*/agents/*/workspace/*/memory/*",
    ]
    review = [
      "tenants/*/agents/*/workspace/review/*",
      "tenants/*/agents/*/workspace/*/review/*",
    ]
    errors = [
      "tenants/*/agents/*/workspace/errors/*",
      "tenants/*/agents/*/workspace/*/errors/*",
    ]
    intents = [
      "tenants/*/agents/*/workspace/events/intents/*.json",
      "tenants/*/agents/*/workspace/*/events/intents/*.json",
    ]
    audit = [
      "tenants/*/agents/*/workspace/events/audit/*",
    ]
  }
}

resource "aws_sqs_queue" "workspace_event_dlq" {
  for_each = local.workspace_event_enabled ? local.workspace_event_patterns : {}

  name                      = "thinkwork-${var.stage}-workspace-events-${each.key}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "workspace_event" {
  for_each = local.workspace_event_enabled ? local.workspace_event_patterns : {}

  name                    = "thinkwork-${var.stage}-workspace-events-${each.key}"
  sqs_managed_sse_enabled = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.workspace_event_dlq[each.key].arn
    maxReceiveCount     = 1
  })
}

resource "aws_cloudwatch_event_rule" "workspace_event" {
  for_each = local.workspace_event_enabled ? local.workspace_event_patterns : {}

  name        = "thinkwork-${var.stage}-workspace-event-${each.key}"
  description = "Workspace orchestration S3 ${each.key} object events"

  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = each.key == "review" ? ["Object Created", "Object Deleted"] : ["Object Created"]
    detail = {
      bucket = {
        name = [var.bucket_name]
      }
      object = {
        key = [for pattern in each.value : { wildcard = pattern }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "workspace_event" {
  for_each = local.workspace_event_enabled ? local.workspace_event_patterns : {}

  rule = aws_cloudwatch_event_rule.workspace_event[each.key].name
  arn  = aws_sqs_queue.workspace_event[each.key].arn
}

resource "aws_sqs_queue_policy" "workspace_event" {
  for_each = local.workspace_event_enabled ? local.workspace_event_patterns : {}

  queue_url = aws_sqs_queue.workspace_event[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.workspace_event[each.key].arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.workspace_event[each.key].arn
          }
        }
      },
    ]
  })
}

resource "aws_lambda_event_source_mapping" "workspace_event_dispatcher" {
  for_each = local.workspace_event_enabled ? local.workspace_event_patterns : {}

  event_source_arn        = aws_sqs_queue.workspace_event[each.key].arn
  function_name           = aws_lambda_function.handler["workspace-event-dispatcher"].arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 5
  }
}

resource "aws_iam_role_policy" "lambda_workspace_events_sqs" {
  count = local.workspace_event_enabled ? 1 : 0

  name = "thinkwork-${var.stage}-lambda-workspace-events-sqs"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = concat(
          [for q in aws_sqs_queue.workspace_event : q.arn],
          [for q in aws_sqs_queue.workspace_event_dlq : q.arn],
        )
      },
    ]
  })
}
