# ---------------------------------------------------------------------------
# AgentCore runtime dispatch DLQ + redrive (THINK-585 U6, KTD2/R5/R19)
# ---------------------------------------------------------------------------
# The dispatcher Lambda runs Event-mode with retries=0 (the agent loop is not
# idempotent). An invoke that dies before the handler can mark its turn
# failed (crash, OOM, 900 s timeout) lands in this queue via the on-failure
# destination; the redrive consumer marks the enveloped thread_turn failed
# idempotently and emits the dispatch_dlq_redrive metric line for the U8
# dashboard. R19 hardening: SSE-KMS (AWS-managed key), ≤24 h retention.

resource "aws_sqs_queue" "agentcore_dispatch_dlq" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                              = "thinkwork-${var.stage}-agentcore-dispatch-dlq"
  message_retention_seconds         = 86400 # 24 h (R19)
  kms_master_key_id                 = "alias/aws/sqs"
  kms_data_key_reuse_period_seconds = 300

  tags = {
    Name  = "thinkwork-${var.stage}-agentcore-dispatch-dlq"
    Stage = var.stage
  }
}

# Retries pinned to 0 (KTD2): a retried dispatch would re-burn Bedrock
# tokens and could overwrite the first attempt's deliverables. Failures go
# straight to the DLQ for the redrive consumer.
resource "aws_lambda_function_event_invoke_config" "agentcore_runtime_dispatch" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["agentcore-runtime-dispatch"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = aws_sqs_queue.agentcore_dispatch_dlq[0].arn
    }
  }
}

resource "aws_lambda_event_source_mapping" "agentcore_dispatch_dlq_redrive" {
  count = local.deploy_lambda_handlers ? 1 : 0

  event_source_arn = aws_sqs_queue.agentcore_dispatch_dlq[0].arn
  function_name    = aws_lambda_function.handler["agentcore-dispatch-dlq-redrive"].function_name
  batch_size       = 10
  # Single consumer is plenty — the queue should be empty in steady state
  # (non-empty is a soak-gate failure per R18).
  scaling_config {
    maximum_concurrency = 2
  }
}
