locals {
  workspace_event_enabled = var.enable_workspace_orchestration && local.use_local_zips
  # EventBridge rejects the more precise per-folder S3 wildcard rules as too
  # complex. Keep broad workspace/catalog families in separate rules and let the
  # dispatcher keep the canonical allowlist in code.
  workspace_event_patterns = {
    workspace = [
      "tenants/*/agents/*/workspace/*",
    ]
    catalog_skills = [
      "tenants/*/agents/_catalog/*/workspace/skills/*",
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

  name                       = "thinkwork-${var.stage}-workspace-events-${each.key}"
  visibility_timeout_seconds = 180
  sqs_managed_sse_enabled    = true

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
    "detail-type" = ["Object Created", "Object Deleted"]
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
