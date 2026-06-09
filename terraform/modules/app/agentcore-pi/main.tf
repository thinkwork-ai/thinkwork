################################################################################
# AgentCore Pi — App Module
#
# Plan §005 U2 — provisions the Pi agent runtime as a Lambda+LWA function.
#
# Layout note: this module owns the IAM role, log group, Lambda function, and
# event-invoke config that are unique to Pi. Shared AgentCore platform
# resources are injected via input variables; the IAM policy here grants
# `sqs:SendMessage` against the shared DLQ ARN.
#
# State migration: the resources here previously lived inside `module.agentcore`
# (the legacy runtime module) under the address `aws_*.agentcore_pi`. The
# parent module's `moved {}` blocks realign state across modules without
# destroy+create on the underlying AWS resources.
################################################################################

# memory-retain Lambda name + ARN are constructed locally rather than
# taken as inputs to avoid a circular dependency: the lambda-api module
# already consumes this module's output (agentcore_pi_function_name/arn).
locals {
  memory_retain_fn_name = "thinkwork-${var.stage}-api-memory-retain"
  memory_retain_fn_arn  = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.memory_retain_fn_name}"
  pi_image_uri          = "${var.ecr_repository_url}:pi-latest"
}

################################################################################
# Execution Role
################################################################################

resource "aws_iam_role" "agentcore_pi" {
  name = "thinkwork-${var.stage}-agentcore-pi-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["ecs-tasks.amazonaws.com", "lambda.amazonaws.com", "bedrock-agentcore.amazonaws.com"] }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-pi-role"
  }
}

resource "aws_iam_role_policy" "agentcore_pi" {
  name = "agentcore-pi-permissions"
  role = aws_iam_role.agentcore_pi.id

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
        # Bedrock invoke spans foundation models, inference profiles, and
        # cross-region routing. The original
        # `arn:aws:bedrock:${region}::foundation-model/*` only covered
        # foundation models in the primary region — but a
        # `us.anthropic.claude-sonnet-...` inference profile (the default
        # routing path used by chat-agent-invoke) lives at
        # `arn:aws:bedrock:${region}:${account}:inference-profile/*` AND
        # dispatches the actual InvokeModel call to the foundation model
        # in whatever region the profile resolves to (us-east-1,
        # us-east-2, us-west-2). The narrow ARN caused every agent turn
        # to fail with AccessDenied silently inside pi-ai's Bedrock
        # provider, surfacing as an empty assistant message with zero
        # token usage. Inference profiles and their routed foundation-model
        # calls require broad model resource scope.
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:InvokeAgent"]
        Resource = "*"
      },
      {
        # Automatic memory retention — every agent turn calls CreateEvent
        # to feed AgentCore's background strategies. Also needs read access
        # so the recall() tool can fetch previously extracted records and
        # so forget() can soft-archive old records.
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
        # Browser Automation (browser_automation tool). Pi can open managed
        # AgentCore Browser sessions when the built-in browser capability is
        # enabled for an agent.
        Sid    = "AgentCoreBrowser"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:StartBrowserSession",
          "bedrock-agentcore:StopBrowserSession",
          "bedrock-agentcore:GetBrowserSession",
          "bedrock-agentcore:ListBrowserSessions",
          "bedrock-agentcore:InvokeBrowser",
          "bedrock-agentcore:UpdateBrowserStream",
        ]
        Resource = [
          "arn:aws:bedrock-agentcore:${var.region}:aws:browser/aws.browser.v1",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:browser/*",
        ]
      },
      {
        # AgentCore Code Interpreter — Pi's primary sandbox per the FR-9a
        # integration spike (`packages/pi-aws/connectors/agentcore-
        # codeinterpreter.ts`). Per-tenant interpreters live under
        # `code-interpreter-custom/*`; sessions are started, exec'd against,
        # and stopped per Pi invocation.
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
        # Secrets Manager — Pi resolves db credentials and other runtime
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

resource "aws_iam_role_policy" "agentcore_pi_dlq_send" {
  name = "agentcore-pi-dlq-send"
  role = aws_iam_role.agentcore_pi.id

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

resource "aws_cloudwatch_log_group" "agentcore_pi" {
  name              = "/thinkwork/${var.stage}/agentcore-pi"
  retention_in_days = 30

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-pi-logs"
  }
}

################################################################################
# Lambda Container Image
################################################################################

resource "terraform_data" "seed_pi_image" {
  count = var.source_image_uri != "" ? 1 : 0

  triggers_replace = {
    source_image_uri = var.source_image_uri
    target_image_uri = local.pi_image_uri
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      set -euo pipefail
      repo_root="${abspath("${path.module}/../../../..")}"
      aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${var.account_id}.dkr.ecr.${var.region}.amazonaws.com
      if docker pull "${var.source_image_uri}"; then
        source_id="$(docker image inspect --format '{{.Id}}' "${var.source_image_uri}")"
        docker tag "$source_id" "${local.pi_image_uri}"
      else
        echo "Unable to pull release image ${var.source_image_uri}; building Pi image from $repo_root"
        docker build \
          -f "$repo_root/packages/agentcore-pi/agent-container/Dockerfile" \
          -t "${local.pi_image_uri}" \
          "$repo_root"
      fi
      docker push "${local.pi_image_uri}"
    EOT
  }
}

resource "aws_lambda_function" "agentcore_pi" {
  function_name = "thinkwork-${var.stage}-agentcore-pi"
  role          = aws_iam_role.agentcore_pi.arn
  package_type  = "Image"
  image_uri     = local.pi_image_uri
  timeout       = 900
  memory_size   = 2048

  depends_on = [terraform_data.seed_pi_image]

  environment {
    variables = {
      PORT                                   = "8080"
      AWS_LWA_PORT                           = "8080"
      AGENTCORE_MEMORY_ID                    = var.agentcore_memory_id
      AGENTCORE_FILES_BUCKET                 = var.bucket_name
      MEMORY_ENGINE                          = var.memory_engine
      REQUESTER_IDLE_MEMORY_LEARNING_ENABLED = tostring(var.requester_idle_memory_learning_enabled)
      MEMORY_RETAIN_FN_NAME                  = local.memory_retain_fn_name
      HINDSIGHT_ENDPOINT                     = var.hindsight_endpoint
      THINKWORK_API_URL                      = var.api_endpoint
      API_AUTH_SECRET                        = var.api_auth_secret
      # Plan §005 U4 — AuroraSessionStore uses the RDS Data API to persist
      # Pi's SessionData blobs against threads.session_data. Empty during
      # the first greenfield apply (DB cluster doesn't exist yet); the
      # constructor fail-closes if either is missing at runtime.
      DB_CLUSTER_ARN = var.db_cluster_arn
      DB_SECRET_ARN  = var.db_secret_arn
    }
  }

  logging_config {
    log_group  = aws_cloudwatch_log_group.agentcore_pi.name
    log_format = "Text"
  }

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-pi"
  }
}

################################################################################
# Async-invoke hardening — MaximumRetryAttempts=0 + DLQ
#
# AWS Lambda async-invoke defaults to 2 retries; the agent loop is not
# idempotent (Bedrock tokens get re-burned, partial deliverables can
# overwrite the first), so retries are disabled and failed invokes land in
# the shared DLQ for operator visibility.
################################################################################

resource "aws_lambda_function_event_invoke_config" "agentcore_pi" {
  function_name                = aws_lambda_function.agentcore_pi.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = var.async_dlq_arn
    }
  }
}
