################################################################################
# THINK-316 U1 — AgentCore Gateway + Cedar proof boundary
#
# AgentCore Gateway and Policy do not yet have complete Terraform resources.
# The module therefore owns their lifecycle with idempotent AWS CLI scripts,
# matching the repo's existing AgentCore Memory pattern. All resources are
# proof-only and opt in; destroy removes policy -> target -> gateway -> engine.
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
  gateway_name = "thinkwork-${var.stage}-multiplayer-proof"
  target_name  = "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerProof"
  # Policy resources accept only letters, digits, and underscores and must
  # begin with a letter. Gateway names have a separate, hyphen-friendly API.
  policy_engine_name = "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}MultiplayerProof"
  policy_name        = "Thinkwork${replace(title(replace(var.stage, "-", " ")), " ", "")}OwnerIsolation"
  configuration_hash = nonsensitive(sha256(jsonencode({
    discovery_url = var.discovery_url
    audience      = var.gateway_audience
    target_url    = var.target_base_url
    provider_arn  = var.oauth_credential_provider_arn
    secret_arn    = var.oauth_credential_secret_arn
    return_url    = var.oauth_return_url
    owners        = var.proof_owner_allowlist
    # URL-mode OAuth elicitation requires the 2025-11-25 protocol and cannot
    # be added to an existing Gateway, so changing this contract must replace
    # the script-owned Gateway lifecycle.
    protocol_versions = ["2025-03-26", "2025-11-25"]
  })))
}

resource "aws_iam_role" "gateway_execution" {
  count = var.enabled ? 1 : 0
  name  = "thinkwork-${var.stage}-agentcore-proof-gateway-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowAgentCoreGateway"
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "gateway_execution" {
  count = var.enabled ? 1 : 0
  name  = "thinkwork-${var.stage}-agentcore-proof-gateway"
  role  = aws_iam_role.gateway_execution[0].id

  # U1 bootstraps service-generated Gateway/Policy ids, so the dedicated
  # proof role uses type-scoped wildcards for those two resource families.
  # Identity and Secrets access are already scoped to exact returned ARNs;
  # U9 replaces the bootstrap wildcards with the selected resource ids.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PolicyEngineConfiguration"
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:GetPolicyEngine"]
        Resource = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:policy-engine/*"
      },
      {
        Sid    = "PolicyAuthorization"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:AuthorizeAction",
          "bedrock-agentcore:PartiallyAuthorizeActions",
        ]
        Resource = [
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:policy-engine/*",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:gateway/*",
        ]
      },
      {
        Sid    = "GatewayWorkloadToken"
        Effect = "Allow"
        # A CUSTOM_JWT Gateway uses the JWT-specific exchange action at
        # runtime even though the current outbound-auth guide shows only the
        # generic workload-token action in its example role.
        Action = [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
        ]
        Resource = [
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default/workload-identity/${local.gateway_name}-*",
        ]
      },
      {
        Sid    = "ExactOauthCredential"
        Effect = "Allow"
        Action = ["bedrock-agentcore:GetResourceOauth2Token"]
        # Identity evaluates the request against the directory, concrete
        # Gateway-managed workload identity, token vault, and provider. All
        # four resource families must be present for resource-scoped access.
        Resource = [
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default/workload-identity/${local.gateway_name}-*",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:token-vault/default",
          var.oauth_credential_provider_arn,
        ]
      },
      {
        Sid      = "ExactOauthSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.oauth_credential_secret_arn
      },
    ]
  })
}

resource "terraform_data" "gateway_lifecycle" {
  count = var.enabled ? 1 : 0

  input = {
    region             = var.region
    gateway_name       = local.gateway_name
    target_name        = local.target_name
    policy_engine_name = local.policy_engine_name
    policy_name        = local.policy_name
  }
  triggers_replace = [local.configuration_hash]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/reconcile_gateway.sh"
    environment = {
      AWS_REGION                    = var.region
      GATEWAY_NAME                  = local.gateway_name
      GATEWAY_ROLE_ARN              = aws_iam_role.gateway_execution[0].arn
      GATEWAY_DISCOVERY_URL         = var.discovery_url
      GATEWAY_AUDIENCE              = var.gateway_audience
      TARGET_NAME                   = local.target_name
      TARGET_BASE_URL               = trimsuffix(var.target_base_url, "/")
      OAUTH_CREDENTIAL_PROVIDER_ARN = var.oauth_credential_provider_arn
      OAUTH_RETURN_URL              = var.oauth_return_url
      POLICY_ENGINE_NAME            = local.policy_engine_name
      POLICY_NAME                   = local.policy_name
      PROOF_OWNER_ALLOWLIST         = var.proof_owner_allowlist
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "bash ${path.module}/scripts/delete_gateway.sh"
    environment = {
      AWS_REGION         = self.input.region
      GATEWAY_NAME       = self.input.gateway_name
      TARGET_NAME        = self.input.target_name
      POLICY_ENGINE_NAME = self.input.policy_engine_name
      POLICY_NAME        = self.input.policy_name
    }
  }

  depends_on = [aws_iam_role_policy.gateway_execution]
}

data "external" "gateway_state" {
  count      = var.enabled ? 1 : 0
  depends_on = [terraform_data.gateway_lifecycle]
  program    = ["bash", "${path.module}/scripts/read_gateway.sh"]

  query = {
    region             = var.region
    gateway_name       = local.gateway_name
    target_name        = local.target_name
    policy_engine_name = local.policy_engine_name
    policy_name        = local.policy_name
  }
}
