################################################################################
# AgentCore Harness — App Module (THINK-316 managed multiplayer runtime)
#
# Stable execution role plus the optional managed tenant/profile Harness and
# named immutable-version endpoint.
#
# Trust-policy note: sibling agentcore roles (agentcore-pi, agentcore-runtime)
# trust the bare `bedrock-agentcore.amazonaws.com` service principal with no
# account/source-arn conditions; this role mirrors that repo pattern.
################################################################################

terraform {
  required_providers {
    external = {
      source  = "hashicorp/external"
      version = ">= 2.3.0"
    }
  }
}

locals {
  normalized_stage   = replace(var.stage, "-", "_")
  normalized_tenant  = replace(var.tenant_slug, "-", "_")
  normalized_profile = replace(var.trust_profile, "-", "_")
  harness_name       = "Thinkwork_${local.normalized_stage}_${local.normalized_tenant}_${local.normalized_profile}"
  endpoint_name      = "ThinkworkProof"
  gateway_target_tool_names = [
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___owner_probe",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___mixed_disclosure",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___list_connector_tools",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___call_connector_tool",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___execute_code",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___web_search",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___web_extract",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___query_brain",
    "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof___send_email",
  ]
  tenant_skill_prefix = var.tenant_slug != "" ? (
    "tenants/${var.tenant_slug}/"
  ) : "tenants/"
  configuration_hash = nonsensitive(sha256(jsonencode({
    tenant_slug      = var.tenant_slug
    profile          = var.trust_profile
    discovery        = var.discovery_url
    audience         = var.harness_audience
    gateway_arn      = var.gateway_arn
    provider_arn     = var.oauth_credential_provider_arn
    return_url       = var.oauth_return_url
    target_tools     = local.gateway_target_tool_names
    model_id         = var.model_id
    memory           = "disabled"
    tool_policy      = "gateway-and-cedar-authoritative"
    connector_facade = "intent-ranked-direct-v1"
    sandbox_facade   = "bounded-internal-python-v1"
    builtin_web      = "tenant-policy-secret-bound-v1"
    platform_tools   = "brain-read-email-content-contract-assigned-approval-v3"
    artifact_facade  = "caller-fulfilled-emit-document-v1"
  })))
}

check "managed_harness_configuration" {
  assert {
    condition = !var.managed_runtime_enabled || (
      var.enabled &&
      var.tenant_slug != "" &&
      can(regex("^https://", var.discovery_url)) &&
      var.harness_audience != "" &&
      can(regex("^arn:aws:bedrock-agentcore:", var.gateway_arn)) &&
      can(regex("^arn:aws:bedrock-agentcore:", var.oauth_credential_provider_arn)) &&
      can(regex("^arn:aws:secretsmanager:", var.oauth_credential_secret_arn))
      && can(regex("^https://", var.oauth_return_url))
    )
    error_message = "The managed AgentCore Harness requires the base role, tenant, HTTPS discovery, exact audience, Gateway, OAuth provider, and provider secret."
  }
}

################################################################################
# Harness execution role — assumed by Harness microVMs
################################################################################

resource "aws_iam_role" "harness_execution" {
  count = var.enabled ? 1 : 0

  name = "thinkwork-${var.stage}-agentcore-harness-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-harness-role"
  }
}

resource "aws_iam_role_policy" "harness_execution" {
  count = var.enabled ? 1 : 0

  name = "agentcore-harness-permissions"
  role = aws_iam_role.harness_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Cross-region inference profiles (us.anthropic.claude-*) require
        # `bedrock:InvokeModel` on the *inference-profile* ARN AND on the
        # underlying foundation-model ARN in every region the profile can
        # route to — same resource list the api Lambda's grouped ai policy
        # uses (see ../lambda-api/iam-grouped.tf "bedrock-invoke").
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:*:${var.account_id}:inference-profile/*",
        ]
      },
      {
        # Tenant skill catalog sources + materialized workspace skill folders
        # live under tenants/* in the stage workspace bucket. Read-only —
        # Harness microVMs never write back to the workspace bucket.
        Sid      = "WorkspaceSkillSourcesRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::${var.bucket_name}/${local.tenant_skill_prefix}*"
      },
      {
        Sid      = "WorkspaceSkillSourcesList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::${var.bucket_name}"
        Condition = {
          StringLike = {
            "s3:prefix" = "${local.tenant_skill_prefix}*"
          }
        }
      },
      {
        # Harness containers log to the service-managed bedrock-agentcore
        # log-group namespace, mirroring the agentcore-pi role's runtimes
        # grant.
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/*:*",
        ]
      },
      {
        Sid      = "SelectedTenantGateway"
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeGateway"]
        Resource = var.managed_runtime_enabled ? var.gateway_arn : "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:gateway/disabled"
      },
      {
        Sid    = "ExactUserIdentityExchange"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetResourceOauth2Token",
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
        ]
        Resource = var.managed_runtime_enabled ? [
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:token-vault/default",
          var.oauth_credential_provider_arn,
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default",
          # AgentCore prefixes the managed runtime workload identity with
          # `harness_`, then appends its generated runtime id.
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default/workload-identity/harness_${local.harness_name}-*",
        ] : ["arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default/workload-identity/disabled"]
      },
      {
        Sid      = "ExactOauthProviderSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.managed_runtime_enabled ? var.oauth_credential_secret_arn : "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:disabled"
      },
      {
        # The service-managed Harness container resolves its public base image
        # at startup under the execution role.
        Sid    = "PublicHarnessImage"
        Effect = "Allow"
        Action = [
          "ecr-public:GetAuthorizationToken",
          "sts:GetServiceBearerToken",
        ]
        Resource = "*"
      },
      {
        Sid    = "HarnessRuntimeTelemetry"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
    ]
  })
}

################################################################################
# One stable tenant/profile Harness and named version-pinned endpoint.
################################################################################

moved {
  from = terraform_data.managed_multiplayer_harness
  to   = terraform_data.managed_multiplayer_harness_identity
}

# Owns deletion of the stable stage/tenant/profile identity. Configuration
# revisions are reconciled separately so an ordinary prompt/tool/model update
# creates a new immutable Harness version without replacing the Harness ARN.
resource "terraform_data" "managed_multiplayer_harness_identity" {
  count = var.managed_runtime_enabled ? 1 : 0

  input = {
    region        = var.region
    harness_name  = local.harness_name
    endpoint_name = local.endpoint_name
  }
  provisioner "local-exec" {
    when    = destroy
    command = "bash ${path.module}/scripts/delete_harness.sh"
    environment = {
      AWS_REGION    = self.input.region
      HARNESS_NAME  = self.input.harness_name
      ENDPOINT_NAME = self.input.endpoint_name
    }
  }

  depends_on = [aws_iam_role_policy.harness_execution]
}

resource "terraform_data" "managed_multiplayer_harness_configuration" {
  count = var.managed_runtime_enabled ? 1 : 0

  input            = local.configuration_hash
  triggers_replace = [local.configuration_hash]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/reconcile_harness.sh"
    environment = {
      AWS_REGION                    = var.region
      HARNESS_NAME                  = local.harness_name
      ENDPOINT_NAME                 = local.endpoint_name
      EXECUTION_ROLE_ARN            = aws_iam_role.harness_execution[0].arn
      DISCOVERY_URL                 = var.discovery_url
      HARNESS_AUDIENCE              = var.harness_audience
      GATEWAY_ARN                   = var.gateway_arn
      GATEWAY_TARGET_TOOL_NAMES     = join(",", local.gateway_target_tool_names)
      OAUTH_CREDENTIAL_PROVIDER_ARN = var.oauth_credential_provider_arn
      OAUTH_RETURN_URL              = var.oauth_return_url
      MODEL_ID                      = var.model_id
      TENANT_SLUG                   = var.tenant_slug
      TRUST_PROFILE                 = var.trust_profile
      CONFIGURATION_HASH            = local.configuration_hash
    }
  }

  depends_on = [terraform_data.managed_multiplayer_harness_identity]
}

data "external" "harness_state" {
  count      = var.managed_runtime_enabled ? 1 : 0
  depends_on = [terraform_data.managed_multiplayer_harness_configuration]
  program    = ["bash", "${path.module}/scripts/read_harness.sh"]

  query = {
    region        = var.region
    harness_name  = local.harness_name
    endpoint_name = local.endpoint_name
  }
}
