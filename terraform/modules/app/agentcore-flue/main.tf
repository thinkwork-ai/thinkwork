################################################################################
# AgentCore Flue — App Module
#
# Plan §005 U2 — provisions the Flue agent runtime as a Lambda+LWA function.
#
# Layout note: this module owns the IAM role, log group, Lambda function, and
# event-invoke config that are unique to Flue. The shared ECR repo and async
# DLQ live in `../agentcore-runtime` and are injected via input variables; the
# IAM policy here grants `sqs:SendMessage` against the shared DLQ ARN.
#
# State migration: the resources here previously lived inside `module.agentcore`
# (the Strands runtime module) under the address `aws_*.agentcore_flue`. The
# `moved {}` blocks in `terraform/modules/thinkwork/main.tf` realign state
# across modules without destroy+create on the underlying AWS resources.
#
# Forward compat: U4-U8 will tighten the IAM role with Aurora Data API
# permissions for SessionStore, Secrets Manager for resolved DB credentials,
# and the AgentCore Code Interpreter actions that the FR-9a spike exercised.
# U2 lays the role down with the minimum permissions Flue needs to boot —
# subsequent units extend it as their dependencies land.
################################################################################

# memory-retain Lambda name + ARN are constructed locally rather than
# taken as inputs to avoid a circular dependency: the lambda-api module
# already consumes this module's output (agentcore_flue_function_name/arn).
# Mirrors the pattern in `../agentcore-runtime/main.tf`.
locals {
  memory_retain_fn_name = "thinkwork-${var.stage}-api-memory-retain"
  memory_retain_fn_arn  = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.memory_retain_fn_name}"
}

################################################################################
# Execution Role
################################################################################

resource "aws_iam_role" "agentcore_flue" {
  name = "thinkwork-${var.stage}-agentcore-flue-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["ecs-tasks.amazonaws.com", "lambda.amazonaws.com", "bedrock-agentcore.amazonaws.com"] }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-flue-role"
  }
}

resource "aws_iam_role_policy" "agentcore_flue" {
  # Sibling policy: ../agentcore-runtime/main.tf `aws_iam_role_policy.agentcore`.
  # The two policies share ~83% of statements (S3, Bedrock, AgentCore Memory,
  # Code Interpreter, Logs, X-Ray, ECR, SSM, MemoryRetain). Flue adds Aurora
  # Data API + Secrets Manager for U4 SessionStore. Keep both surfaces in
  # sync for shared statements; let Flue-only additions diverge here.
  name = "agentcore-flue-permissions"
  role = aws_iam_role.agentcore_flue.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Access"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.bucket_name}",
          "arn:aws:s3:::${var.bucket_name}/*",
        ]
      },
      {
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:InvokeAgent"]
        Resource = "arn:aws:bedrock:${var.region}::foundation-model/*"
      },
      {
        # Automatic memory retention — every agent turn calls CreateEvent
        # to feed AgentCore's background strategies. Also needs read access
        # so the recall() tool can fetch previously extracted records and
        # so forget() can soft-archive old records. Mirrors the Strands role.
        Sid    = "AgentCoreMemoryReadWrite"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:RetrieveMemoryRecords",
          "bedrock-agentcore:GetMemoryRecord",
          "bedrock-agentcore:BatchCreateMemoryRecords",
          "bedrock-agentcore:BatchUpdateMemoryRecords",
        ]
        Resource = "*"
      },
      {
        # AgentCore Code Interpreter — Flue's primary sandbox per the FR-9a
        # integration spike (`packages/flue-aws/connectors/agentcore-
        # codeinterpreter.ts`). Per-tenant interpreters live under
        # `code-interpreter-custom/*`; sessions are started, exec'd against,
        # and stopped per Flue invocation.
        Sid    = "AgentCoreCodeInterpreter"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
          "bedrock-agentcore:GetCodeInterpreterSession",
          "bedrock-agentcore:ListCodeInterpreterSessions",
          "bedrock-agentcore:GetCodeInterpreter",
        ]
        Resource = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:code-interpreter-custom/*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
        ]
        # Lambda log group + AgentCore Runtime container log groups + the
        # account-wide aws/spans log group (CloudWatch Transaction Search
        # destination — required for AgentCore Evaluations to read spans).
        Resource = [
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/thinkwork-${var.stage}-*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/thinkwork-${var.stage}-*:*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:aws/spans",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:aws/spans:*",
        ]
      },
      {
        # X-Ray ingestion — ADOT exporters publish spans here, which then
        # flow to aws/spans via the Transaction Search policy. AgentCore
        # Evaluations queries those spans by session.id when scoring runs.
        Sid    = "XRayIngest"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = [
          "arn:aws:xray:${var.region}:${var.account_id}:*",
          "*",
        ]
      },
      {
        Sid      = "ECRPull"
        Effect   = "Allow"
        Action   = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "arn:aws:ecr:${var.region}:${var.account_id}:repository/thinkwork-${var.stage}-*"
      },
      {
        Sid      = "ECRAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "SSMParameterAccess"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/agentcore/*"
      },
      {
        # Async-invoke the memory-retain Lambda after every chat turn so
        # the API's normalized memory layer can run the active engine's
        # retainTurn() path (Hindsight POST /memories or AgentCore
        # CreateEvent). InvocationType=Event from the runtime; this Lambda
        # is the only target.
        Sid      = "MemoryRetainInvoke"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = local.memory_retain_fn_arn
      },
      {
        # Aurora Data API — U4 SessionStore writes thread/message rows via
        # the RDS Data API rather than long-lived Postgres connections.
        # The cluster ARN and credentials secret are wired through the API
        # Lambda's env (Plan §005 U4); listed here as broad cluster scope
        # because the cluster ARN isn't an input to this module yet.
        Sid    = "AuroraDataAPI"
        Effect = "Allow"
        Action = [
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:RollbackTransaction",
        ]
        Resource = "arn:aws:rds:${var.region}:${var.account_id}:cluster:thinkwork-${var.stage}-db-*"
      },
      {
        # Secrets Manager — Flue resolves db credentials and other runtime
        # secrets at invocation time per `feedback_completion_callback_
        # snapshot_pattern`. Scoped to `/thinkwork/${stage}/*` per the
        # existing convention.
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork-${var.stage}-*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "agentcore_flue_dlq_send" {
  name = "agentcore-flue-dlq-send"
  role = aws_iam_role.agentcore_flue.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = var.async_dlq_arn
    }]
  })
}

################################################################################
# CloudWatch Log Group
################################################################################

resource "aws_cloudwatch_log_group" "agentcore_flue" {
  name              = "/thinkwork/${var.stage}/agentcore-flue"
  retention_in_days = 30

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-flue-logs"
  }
}

################################################################################
# Lambda Container Image
################################################################################

resource "aws_lambda_function" "agentcore_flue" {
  function_name = "thinkwork-${var.stage}-agentcore-flue"
  role          = aws_iam_role.agentcore_flue.arn
  package_type  = "Image"
  image_uri     = "${var.ecr_repository_url}:flue-latest"
  timeout       = 900
  memory_size   = 2048

  environment {
    variables = {
      PORT                   = "8080"
      AWS_LWA_PORT           = "8080"
      AGENTCORE_MEMORY_ID    = var.agentcore_memory_id
      AGENTCORE_FILES_BUCKET = var.bucket_name
      MEMORY_ENGINE          = var.memory_engine
      MEMORY_RETAIN_FN_NAME  = local.memory_retain_fn_name
      THINKWORK_API_URL      = var.api_endpoint
      API_AUTH_SECRET        = var.api_auth_secret
    }
  }

  logging_config {
    log_group  = aws_cloudwatch_log_group.agentcore_flue.name
    log_format = "Text"
  }

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-flue"
  }
}

################################################################################
# Async-invoke hardening — MaximumRetryAttempts=0 + DLQ
#
# Mirrors the Strands runtime's invoke-config in `../agentcore-runtime/main.tf`.
# AWS Lambda async-invoke defaults to 2 retries; the agent loop is not
# idempotent (Bedrock tokens get re-burned, partial deliverables can
# overwrite the first), so retries are disabled and failed invokes land in
# the shared DLQ for operator visibility.
################################################################################

resource "aws_lambda_function_event_invoke_config" "agentcore_flue" {
  function_name                = aws_lambda_function.agentcore_flue.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = var.async_dlq_arn
    }
  }
}
