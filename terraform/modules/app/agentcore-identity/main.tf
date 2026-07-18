################################################################################

terraform {
  required_providers {
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
  workload_identity_name   = "thinkwork-${var.stage}-multiplayer-proof"
  credential_provider_name = "thinkwork-${var.stage}-proof-oauth"
  oauth_issuer             = trimsuffix(var.oauth_issuer, "/")
  oauth_return_url         = "${local.oauth_issuer}/complete"
  configuration_hash = nonsensitive(sha256(jsonencode({
    issuer        = local.oauth_issuer
    client_id     = var.oauth_client_id
    secret_digest = sha256(var.oauth_client_secret)
    return_url    = local.oauth_return_url
  })))
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

# Read back the service-generated ARNs only after apply-time reconciliation.
# Gateway IAM can therefore scope vault and secret access exactly rather than
# granting a token-vault or Secrets Manager wildcard.
data "external" "identity_state" {
  count      = var.enabled ? 1 : 0
  depends_on = [terraform_data.identity_lifecycle]
  program    = ["bash", "${path.module}/scripts/read_identity.sh"]

  query = {
    region                   = var.region
    workload_identity_name   = local.workload_identity_name
    credential_provider_name = local.credential_provider_name
  }
}
