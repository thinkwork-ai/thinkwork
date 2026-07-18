################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    external = {
      source  = "hashicorp/external"
      version = ">= 2.3.0"
    }
  }
}
# THINK-316 U1 — AgentCore Identity proof substrate
#
# The AWS provider does not yet model Workload Identity or OAuth2 credential
# providers. A terraform_data lifecycle wrapper reconciles them with the
# current AWS CLI and owns destroy cleanup. The client secret is passed only in
# the local-exec environment and never printed by the scripts.
################################################################################

locals {
  workload_identity_name          = "thinkwork-${var.stage}-multiplayer-proof"
  credential_provider_name        = "thinkwork-${var.stage}-proof-oauth"
  twenty_credential_provider_name = "thinkwork-${var.stage}-twenty-crm"
  oauth_issuer                    = trimsuffix(var.oauth_issuer, "/")
  oauth_return_url                = "${local.oauth_issuer}/complete"
  allowed_oauth_return_urls       = distinct(concat([local.oauth_return_url], var.user_federation_return_urls))
  configuration_hash = nonsensitive(sha256(jsonencode({
    issuer        = local.oauth_issuer
    client_id     = var.oauth_client_id
    secret_digest = sha256(var.oauth_client_secret)
    return_url    = local.oauth_return_url
  })))
  twenty_configuration_hash = nonsensitive(sha256(jsonencode({
    allowed_oauth_return_urls       = local.allowed_oauth_return_urls
    twenty_credential_provider_name = local.twenty_credential_provider_name
    twenty_oauth_issuer             = var.twenty_oauth_issuer
    twenty_oauth_resource           = var.twenty_oauth_resource
    twenty_client_secret_arn        = try(aws_secretsmanager_secret.twenty_oauth_client[0].arn, "")
  })))
}

# The DCR client secret is written by the reconciler, not Terraform, so its
# value never enters Terraform state. AgentCore Identity reads the JSON key
# directly and remains the sole custodian of each user's downstream grant.
resource "aws_secretsmanager_secret" "twenty_oauth_client" {
  count = var.enabled ? 1 : 0

  name                    = "thinkwork/${var.stage}/agentcore-identity/twenty-crm-oauth-client"
  description             = "Confidential Twenty OAuth client used only by AgentCore Identity Token Vault"
  recovery_window_in_days = 7

  tags = {
    "managed-by"        = "terraform"
    "thinkwork:stage"   = var.stage
    "thinkwork:purpose" = "agentcore-identity-user-federation"
  }
}

resource "aws_secretsmanager_secret_policy" "twenty_oauth_client" {
  count      = var.enabled ? 1 : 0
  secret_arn = aws_secretsmanager_secret.twenty_oauth_client[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AgentCoreIdentityRead"
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "secretsmanager:GetSecretValue"
      Resource  = aws_secretsmanager_secret.twenty_oauth_client[0].arn
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
      }
    }]
  })
}

resource "terraform_data" "identity_lifecycle" {
  count = var.enabled ? 1 : 0

  input = {
    region                   = var.region
    workload_identity_name   = local.workload_identity_name
    credential_provider_name = local.credential_provider_name
  }
  triggers_replace = [local.configuration_hash]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/reconcile_identity.sh"
    environment = {
      AWS_REGION               = var.region
      WORKLOAD_IDENTITY_NAME   = local.workload_identity_name
      CREDENTIAL_PROVIDER_NAME = local.credential_provider_name
      OAUTH_ISSUER             = local.oauth_issuer
      OAUTH_CLIENT_ID          = var.oauth_client_id
      OAUTH_CLIENT_SECRET      = var.oauth_client_secret
      OAUTH_RETURN_URL         = local.oauth_return_url
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "bash ${path.module}/scripts/delete_identity.sh"
    environment = {
      AWS_REGION               = self.input.region
      WORKLOAD_IDENTITY_NAME   = self.input.workload_identity_name
      CREDENTIAL_PROVIDER_NAME = self.input.credential_provider_name
    }
  }
}

# Additive user-federation lifecycle. It may update the workload's callback
# allowlist in place, but it never owns or deletes the workload/Gateway provider.
# This keeps the proven exact-user admission path live while Twenty is added,
# rotated, or removed independently.
resource "terraform_data" "twenty_identity_lifecycle" {
  count = var.enabled ? 1 : 0

  input = {
    region                          = var.region
    workload_identity_name          = local.workload_identity_name
    twenty_credential_provider_name = local.twenty_credential_provider_name
  }
  triggers_replace = [local.twenty_configuration_hash]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/reconcile_twenty_identity.sh"
    environment = {
      AWS_REGION                      = var.region
      WORKLOAD_IDENTITY_NAME          = local.workload_identity_name
      OAUTH_RETURN_URLS_JSON          = jsonencode(local.allowed_oauth_return_urls)
      TWENTY_CREDENTIAL_PROVIDER_NAME = local.twenty_credential_provider_name
      TWENTY_CLIENT_SECRET_ARN        = aws_secretsmanager_secret.twenty_oauth_client[0].arn
      TWENTY_OAUTH_ISSUER             = trimsuffix(var.twenty_oauth_issuer, "/")
      TWENTY_OAUTH_RESOURCE           = var.twenty_oauth_resource
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "bash ${path.module}/scripts/delete_twenty_identity.sh"
    environment = {
      AWS_REGION                      = self.input.region
      TWENTY_CREDENTIAL_PROVIDER_NAME = self.input.twenty_credential_provider_name
    }
  }

  depends_on = [
    terraform_data.identity_lifecycle,
    aws_secretsmanager_secret_policy.twenty_oauth_client,
  ]
}

# Read back the service-generated ARNs only after apply-time reconciliation.
# Gateway IAM can therefore scope vault and secret access exactly rather than
# granting a token-vault or Secrets Manager wildcard.
data "external" "identity_state" {
  count = var.enabled ? 1 : 0
  depends_on = [
    terraform_data.identity_lifecycle,
    terraform_data.twenty_identity_lifecycle,
  ]
  program = ["bash", "${path.module}/scripts/read_identity.sh"]

  query = {
    region                          = var.region
    workload_identity_name          = local.workload_identity_name
    credential_provider_name        = local.credential_provider_name
    twenty_credential_provider_name = local.twenty_credential_provider_name
  }
}
