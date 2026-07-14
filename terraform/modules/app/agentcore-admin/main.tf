################################################################################
# AgentCore Admin — App Module (stage-level)
#
# The `agentcore-admin` Lambda is the control-plane worker that regular sandbox
# provisioning depends on: `createTenant` (packages/api) RequestResponse-invokes
# it to create per-tenant IAM roles + AgentCore Code Interpreters, and it also
# serves SSM permission-profile CRUD + CloudWatch audit queries. The handler
# lives at packages/lambda/agentcore-admin.ts and is bundled by
# scripts/build-lambdas.sh into dist/lambdas/agentcore-admin.zip.
#
# Historically this Lambda was built but instantiated NOWHERE — so sandbox
# provisioning would fail closed at runtime (AGENTCORE_ADMIN_LAMBDA_ARN unset).
# This module deploys it. It is intentionally a SEPARATE module with a DEDICATED
# least-privilege role: the handler holds a dangerous control-plane surface
# (iam:CreateRole, bedrock-agentcore CreateCodeInterpreter) that must never leak
# onto the ~90-handler shared lambda-api role.
#
# THINK-280 capability-private wiring: CAPABILITY_PRIVATE_SUBNET_IDS /
# CAPABILITY_PRIVATE_SECURITY_GROUP_IDS come from the capability-broker outputs
# (via the agentcore-code-interpreter module). Both are EMPTY when the broker is
# disabled (var.enable_capability_broker=false, the default) — the handler then
# skips capability-private provisioning entirely (capabilityPrivateProvisioning
# Enabled() returns false). The module therefore ships INERT for the
# capability-private path while still fixing the regular-provisioning gap.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
  }
}

variable "stage" {
  description = "Deployment stage (dev, prod, etc.)."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "account_id" {
  description = "AWS account ID (used to construct IAM resource ARNs)."
  type        = string
}

# ---- Lambda artifact sources (mirror lambda-api/remote-artifacts.tf) ----------
variable "lambda_zips_dir" {
  description = "Local directory of built Lambda zips (source-checkout deploys). Mutually exclusive with lambda_artifact_bucket."
  type        = string
  default     = ""
}

variable "lambda_artifact_bucket" {
  description = "S3 bucket holding release Lambda zips (enterprise deploys). Mutually exclusive with lambda_zips_dir."
  type        = string
  default     = ""
}

variable "lambda_artifact_prefix" {
  description = "S3 key prefix for release Lambda zips."
  type        = string
  default     = ""
}

# ---- Database (handler reads the tenants table via getDb() → DATABASE_URL) -----
variable "db_username" {
  description = "Database username (used to construct DATABASE_URL)."
  type        = string
  default     = "thinkwork_admin"
}

variable "db_password" {
  description = "Database password (used to construct DATABASE_URL)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "db_cluster_endpoint" {
  description = "Aurora cluster writer endpoint."
  type        = string
}

variable "database_name" {
  description = "Database name."
  type        = string
}

variable "graphql_db_secret_arn" {
  description = "ARN of the writer DB credentials secret (granted GetSecretValue so db.ts's secret fallback works)."
  type        = string
}

# ---- Capability-private interpreter VPC placement (THINK-280 U4) ---------------
# Empty when the capability broker is disabled → handler skips capability-private
# provisioning. Sourced from the broker outputs via the code-interpreter module.
variable "capability_private_subnet_ids" {
  description = "No-NAT subnets for the capability-private VPC-mode interpreter. Empty when the broker is disabled."
  type        = list(string)
  default     = []
}

variable "capability_private_security_group_ids" {
  description = "Egress-only SGs for the capability-private interpreter. Empty when the broker is disabled."
  type        = list(string)
  default     = []
}

################################################################################
# Artifact-source gating — identical semantics to lambda-api/remote-artifacts.tf.
# Exactly one source (local zips OR remote S3) must be set, else the Lambda is
# not deployed (scaffolded installs with no artifacts).
################################################################################

locals {
  use_local_zips              = trimspace(var.lambda_zips_dir) != ""
  use_remote_lambda_artifacts = trimspace(var.lambda_artifact_bucket) != ""
  lambda_artifact_prefix      = trim(trimspace(var.lambda_artifact_prefix), "/")
  artifact_source_count       = (local.use_local_zips ? 1 : 0) + (local.use_remote_lambda_artifacts ? 1 : 0)
  deploy                      = local.artifact_source_count == 1

  function_name = "thinkwork-${var.stage}-api-agentcore-admin"

  # DATABASE_URL built exactly as lambda-api's common_env does so getDb()
  # resolves identically. sslmode=no-verify matches the shared pool (Aurora is
  # reachable over TLS without a bundled CA in this stack).
  database_url = "postgresql://${var.db_username}:${urlencode(var.db_password)}@${var.db_cluster_endpoint}:5432/${var.database_name}?sslmode=no-verify"
}

################################################################################
# Admin bearer token — random_password → Secrets Manager. The token value is
# ALSO injected as the Lambda's AGENTCORE_ADMIN_TOKEN env (the handler compares
# the Bearer header against process.env directly), and handed to graphql-http so
# its invoke carries the matching credential. The secret is the durable record
# of truth for operators / rotation.
################################################################################

resource "random_password" "admin_token" {
  count = local.deploy ? 1 : 0
  # 48 chars, alphanumeric only — safe inside an `Authorization: Bearer` header.
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "admin_token" {
  count       = local.deploy ? 1 : 0
  name        = "thinkwork/${var.stage}/agentcore-admin-token"
  description = "Bearer token the agentcore-admin Lambda validates; graphql-http presents it on RequestResponse invokes."

  tags = {
    Name    = "thinkwork-${var.stage}-agentcore-admin-token"
    Stage   = var.stage
    Purpose = "agentcore-admin-bearer-token"
  }
}

resource "aws_secretsmanager_secret_version" "admin_token" {
  count         = local.deploy ? 1 : 0
  secret_id     = aws_secretsmanager_secret.admin_token[0].id
  secret_string = random_password.admin_token[0].result
}

################################################################################
# IAM role — DEDICATED, least-privilege. Scoped tightly to the handler's actual
# AWS SDK calls (see packages/lambda/agentcore-admin.ts).
################################################################################

resource "aws_iam_role" "admin" {
  count = local.deploy ? 1 : 0
  name  = "thinkwork-${var.stage}-agentcore-admin"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name    = "thinkwork-${var.stage}-agentcore-admin"
    Stage   = var.stage
    Purpose = "agentcore-admin-execution-role"
  }
}

resource "aws_iam_role_policy" "admin" {
  count = local.deploy ? 1 : 0
  name  = "agentcore-admin"
  role  = aws_iam_role.admin[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # --- Lambda's own log group (basic execution) ---
      {
        Sid    = "LambdaOwnLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.function_name}:*"
      },
      # --- CloudWatch audit query (queryAuditLogs) ---
      {
        Sid      = "AuditLogQuery"
        Effect   = "Allow"
        Action   = ["logs:FilterLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/thinkwork/${var.stage}/agentcore/agents:*"
      },
      # --- SSM permission-profile CRUD (getPermissions / putPermissions) ---
      {
        Sid    = "SsmPermissionProfiles"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:PutParameter",
        ]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/*"
      },
      # --- Per-tenant sandbox IAM roles (provision / deprovision) ---
      # Two name prefixes: computeRoleName → sandbox-tenant-*, and the U4
      # capability-private role → cappriv-tenant-*.
      {
        Sid    = "SandboxRoleLifecycle"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:TagRole",
        ]
        Resource = [
          "arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-sandbox-*",
          "arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-cappriv-*",
        ]
      },
      # --- PassRole the sandbox roles to AgentCore (CreateCodeInterpreter) ---
      {
        Sid    = "PassSandboxRolesToAgentCore"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          "arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-sandbox-*",
          "arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-cappriv-*",
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "bedrock-agentcore.amazonaws.com"
          }
        }
      },
      # --- AgentCore Code Interpreter control plane ---
      # List/Create/Delete are account-scoped operations without a stable
      # per-resource ARN at plan time; the SDK client is the control plane.
      {
        Sid    = "CodeInterpreterControlPlane"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:CreateCodeInterpreter",
          "bedrock-agentcore:DeleteCodeInterpreter",
          "bedrock-agentcore:ListCodeInterpreters",
          "bedrock-agentcore:GetCodeInterpreter",
        ]
        Resource = "*"
      },
      # --- Secrets: DB credentials (db.ts secret fallback) + own admin token ---
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          var.graphql_db_secret_arn,
          aws_secretsmanager_secret.admin_token[0].arn,
        ]
      },
    ]
  })
}

################################################################################
# Lambda function
################################################################################

resource "aws_lambda_function" "admin" {
  count = local.deploy ? 1 : 0

  function_name = local.function_name
  role          = aws_iam_role.admin[0].arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 60
  memory_size   = 256

  filename         = local.use_local_zips ? "${var.lambda_zips_dir}/agentcore-admin.zip" : null
  source_code_hash = local.use_local_zips ? filebase64sha256("${var.lambda_zips_dir}/agentcore-admin.zip") : null
  s3_bucket        = local.use_remote_lambda_artifacts ? var.lambda_artifact_bucket : null
  s3_key           = local.use_remote_lambda_artifacts ? "${local.lambda_artifact_prefix}/agentcore-admin.zip" : null

  environment {
    variables = {
      STAGE          = var.stage
      AWS_ACCOUNT_ID = var.account_id
      NODE_OPTIONS   = "--enable-source-maps"
      DATABASE_URL   = local.database_url
      # Bearer token the handler validates. Secret env is the sanctioned home
      # for secrets in this stack (never the SSM runtime-config String doc).
      AGENTCORE_ADMIN_TOKEN = random_password.admin_token[0].result
      # THINK-280 U4 — capability-private interpreter VPC placement. EMPTY when
      # the broker is disabled → the handler skips capability-private entirely.
      CAPABILITY_PRIVATE_SUBNET_IDS         = join(",", var.capability_private_subnet_ids)
      CAPABILITY_PRIVATE_SECURITY_GROUP_IDS = join(",", var.capability_private_security_group_ids)
    }
  }

  tags = {
    Name    = local.function_name
    Stage   = var.stage
    Purpose = "agentcore-admin"
  }
}
