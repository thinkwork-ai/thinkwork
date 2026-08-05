################################################################################
# AgentCore Code Interpreter — App Module (stage-level)
#
# Stage-scoped substrate for the AgentCore Code Interpreter sandbox:
#   * The environment catalog (network modes) the runtime selects from.
#   * IAM policy templates + capability-private VPC placement the per-tenant
#     provisioning Lambda (Unit 5) consumes to CreateCodeInterpreter for each
#     tenant on demand.
#
# **Per-tenant resources live elsewhere.** AgentCore Code Interpreter
# instances are created per-tenant by the ``agentcore-admin`` Lambda at
# tenant-create time — see docs/adrs/per-tenant-aws-resource-fanout.md.
# This module stops at the stage-level substrate.
#
# **No custom image (THINK-617).** This module used to own an ECR repo for a
# "blessed" sandbox base image (Python 3.12 + pinned libs + a sitecustomize.py
# stdio scrubber). AgentCore Code Interpreter has no way to attach one:
# CreateCodeInterpreterRequest carries no image/container parameter. Sandboxes
# always run the AWS-managed image; libraries that image may lack are installed
# on demand by the runtime's execute_code preamble (ON_DEMAND_LIBRARIES in
# packages/agentcore-pi/.../tools/execute-code.ts). The image substrate was
# retired — git history and THINK-617 preserve it.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "stage" {
  description = "Deployment stage (dev, prod, etc.) — names the ECR repo and appears in image tags."
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

# THINK-280 U4 — VPC placement for the capability-private interpreter. Sourced
# (when the capability broker is enabled) from the broker module's no-NAT
# interpreter subnets + dedicated egress-only SG. Empty by default: the
# agentcore-admin Lambda skips capability-private provisioning entirely when
# either list is empty, so the module stays inert with the broker disabled.
variable "capability_private_subnet_ids" {
  description = "No-NAT private subnets the capability-private VPC-mode interpreter attaches to. Empty when the broker is disabled."
  type        = list(string)
  default     = []
}

variable "capability_private_security_group_ids" {
  description = "Egress-only security groups (reach only the broker execute-api VPCE) for the capability-private interpreter. Empty when the broker is disabled."
  type        = list(string)
  default     = []
}

# Environment catalog. Kept as a locals block (not a variable) because v1
# semantics are fixed in the plan — extending requires a reviewable PR,
# not a tfvars tweak.
locals {
  environments = {
    "default-public" = {
      description  = "Full public internet outbound; for community-CLI + pip-install workloads."
      network_mode = "PUBLIC"
    }
    "internal-only" = {
      description  = "S3 + DNS + AWS service endpoints only; no public egress."
      network_mode = "SANDBOX"
    }
    # THINK-280 U4: VPC-mode interpreter, no NAT. Reaches ONLY the capability
    # broker's private execute-api VPCE (+ DNS). Runtime-selected per invocation
    # (not a template-level opt-in), and only provisioned when the broker is
    # enabled — the agentcore-admin Lambda gates on the VPC subnet/SG env vars.
    "capability-private" = {
      description  = "VPC-mode, no NAT; reaches only the capability broker execute-api VPCE."
      network_mode = "VPC"
    }
  }
}

################################################################################
# IAM policy document — per-tenant trust template
#
# Rendered as a JSON string so the agentcore-admin Lambda (Unit 5) can
# substitute {tenant_id} at CreateRole time. Stored as a terraform output so
# the Lambda reads it from SSM or environment — not hard-coded in the
# Lambda source.
################################################################################

locals {
  tenant_role_trust_policy_template = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })

  # Inline policy template: tenant-wildcard read on the sandbox SM path
  # family. {tenant_id} is substituted at CreateRole time.
  tenant_role_inline_policy_template = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SandboxSecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        # Wildcard over users within the tenant. See T1b residual.
        Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/${var.stage}/sandbox/{tenant_id}/*"
      },
      {
        Sid    = "SandboxCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"
      },
    ]
  })

  # THINK-280 U4: SEPARATE restricted inline policy for the capability-private
  # VPC-mode interpreter role. It deliberately LACKS the tenant sandbox Secrets
  # Manager wildcard (SandboxSecretsRead above), tenant S3, and any database /
  # provider access — the private interpreter reaches providers only through the
  # broker's PoP session (AE5). Logs are the only genuine boot requirement.
  # Consumed by the agentcore-admin Lambda for the capability-private role.
  capability_private_role_inline_policy_template = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CapabilityPrivateCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"
      },
    ]
  })
}

################################################################################
# Outputs
################################################################################

output "environment_ids" {
  description = "Enum of valid sandbox environment identifiers."
  value       = keys(local.environments)
}

output "environments" {
  description = "Full environment metadata (network mode + description) for each sandbox environment."
  value       = local.environments
}

output "tenant_role_trust_policy_template" {
  description = "JSON trust-policy template for per-tenant sandbox IAM roles. Consumer substitutes {tenant_id}."
  value       = local.tenant_role_trust_policy_template
}

output "tenant_role_inline_policy_template" {
  description = "JSON inline-policy template for per-tenant sandbox IAM roles. Consumer substitutes {tenant_id}."
  value       = local.tenant_role_inline_policy_template
}

output "capability_private_role_inline_policy_template" {
  description = "THINK-280 U4: JSON inline-policy for the capability-private interpreter role. Logs-only; NO Secrets Manager / S3 / DB access."
  value       = local.capability_private_role_inline_policy_template
}

output "capability_private_subnet_ids" {
  description = "No-NAT subnets the capability-private interpreter attaches to (CAPABILITY_PRIVATE_SUBNET_IDS). Empty when the broker is disabled."
  value       = var.capability_private_subnet_ids
}

output "capability_private_security_group_ids" {
  description = "Egress-only SGs for the capability-private interpreter (CAPABILITY_PRIVATE_SECURITY_GROUP_IDS). Empty when the broker is disabled."
  value       = var.capability_private_security_group_ids
}

output "stage" {
  description = "Echo of the stage variable (convenience for downstream modules)."
  value       = var.stage
}
