################################################################################
# AgentCore Runtime — App Module
#
# Creates ECR repository, IAM roles, and container build infrastructure
# for the Strands-based agent runtime. Full implementation ported in Phase 3.
# Phase 1 creates the ECR repo and IAM scaffolding only.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "bucket_name" {
  description = "Primary S3 bucket for skills and workspace files"
  type        = string
}

variable "hindsight_endpoint" {
  description = "Hindsight API endpoint. Empty string (default) disables Hindsight tools in the container; set to an endpoint URL to enable Hindsight as an add-on alongside the always-on managed memory."
  type        = string
  default     = ""
}

variable "agentcore_memory_id" {
  description = "AgentCore Memory resource ID. Populated automatically by the agentcore-memory module; injected into the container as AGENTCORE_MEMORY_ID for auto-retention."
  type        = string
  default     = ""
}

variable "api_endpoint" {
  description = "Deployed API Gateway base URL. Injected as THINKWORK_API_URL so the composition runner (run_skill dispatch) can POST terminal state back to /api/skills/complete."
  type        = string
  default     = ""
}

variable "api_auth_secret" {
  description = "Service-auth bearer shared secret. Injected as API_AUTH_SECRET so the composition runner can authenticate to /api/skills/complete. Matches the lambda-api module's value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "memory_engine" {
  description = "Active long-term memory engine ('hindsight' or 'agentcore'). Surfaced to the runtime as MEMORY_ENGINE for telemetry/debugging only; engine selection itself happens in the API's normalized memory layer when memory-retain is invoked."
  type        = string
  default     = "hindsight"
  validation {
    condition     = contains(["hindsight", "agentcore"], var.memory_engine)
    error_message = "memory_engine must be 'hindsight' or 'agentcore'."
  }
}

# memory-retain Lambda name + ARN are constructed locally rather than
# taken as inputs to avoid a circular dependency: the lambda-api module
# already consumes this module's outputs (agentcore_function_name/arn).
# The Lambda name follows the deterministic pattern from
# lambda-api/handlers.tf: thinkwork-${stage}-api-${handler_name}.
locals {
  memory_retain_fn_name = "thinkwork-${var.stage}-api-memory-retain"
  memory_retain_fn_arn  = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.memory_retain_fn_name}"
}

################################################################################
# ECR Repository
################################################################################

resource "aws_ecr_repository" "agentcore" {
  name                 = "thinkwork-${var.stage}-agentcore"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-agentcore"
  }
}

resource "aws_ecr_lifecycle_policy" "agentcore" {
  repository = aws_ecr_repository.agentcore.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

################################################################################
# Execution Role
################################################################################

resource "aws_iam_role" "agentcore" {
  name = "thinkwork-${var.stage}-agentcore-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["ecs-tasks.amazonaws.com", "lambda.amazonaws.com", "bedrock-agentcore.amazonaws.com"] }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "agentcore" {
  name = "agentcore-permissions"
  role = aws_iam_role.agentcore.id

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
        # Code Sandbox (execute_code tool). The runtime starts a
        # Code Interpreter session at the top of every sandbox-
        # registered turn and executes the preamble + user code
        # against it. Without this, the runtime role can register
        # the tool but every invocation fails with
        # AccessDeniedException on StartCodeInterpreterSession.
        # Resource wildcards under code-interpreter-custom/* so any
        # tenant's interpreter (provisioned under this account) is
        # reachable by the Strands runtime.
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
        # Each entry is doubled with `:*` so log-STREAM operations are
        # allowed (log-group ARN without `:*` covers group-level ops only).
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
        # CreateEvent). InvocationType=Event from the Python client; this
        # Lambda is the only target.
        Sid      = "MemoryRetainInvoke"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = local.memory_retain_fn_arn
      },
    ]
  })
}

################################################################################
# CloudWatch Log Group
################################################################################

resource "aws_cloudwatch_log_group" "agentcore" {
  name              = "/thinkwork/${var.stage}/agentcore"
  retention_in_days = 30

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-logs"
  }
}

################################################################################
# Lambda Container Image
################################################################################

resource "aws_lambda_function" "agentcore" {
  function_name = "thinkwork-${var.stage}-agentcore"
  role          = aws_iam_role.agentcore.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.agentcore.repository_url}:latest"
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
      # Needed by run_skill_dispatch.py to POST terminal state back to
      # /api/skills/complete after a composition run finishes.
      THINKWORK_API_URL      = var.api_endpoint
      API_AUTH_SECRET        = var.api_auth_secret
    }
  }

  logging_config {
    log_group  = aws_cloudwatch_log_group.agentcore.name
    log_format = "Text"
  }

  tags = {
    Name = "thinkwork-${var.stage}-agentcore"
  }
}

# AgentCore is invoked directly via the Lambda SDK (InvokeCommand) from
# chat-agent-invoke — no Function URL is needed, and exposing one would be
# a public attack surface for prompt injection.

################################################################################
# Outputs
################################################################################

output "ecr_repository_url" {
  description = "ECR repository URL for the AgentCore container"
  value       = aws_ecr_repository.agentcore.repository_url
}

output "execution_role_arn" {
  description = "IAM role ARN for AgentCore execution"
  value       = aws_iam_role.agentcore.arn
}

output "agentcore_function_name" {
  description = "AgentCore Lambda function name (for direct SDK invoke)"
  value       = aws_lambda_function.agentcore.function_name
}

output "agentcore_function_arn" {
  description = "AgentCore Lambda function ARN (for IAM policy on callers)"
  value       = aws_lambda_function.agentcore.arn
}
