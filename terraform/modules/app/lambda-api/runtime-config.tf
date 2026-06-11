# ============================================================================
# SSM runtime-config (plan 2026-06-11-006)
#
# All non-identity, non-secret configuration for the api handlers lives in
# ONE terraform-owned SSM parameter per stage. Handlers read it once per
# container through the AWS Parameters and Secrets Lambda Extension
# (@thinkwork/runtime-config; env always wins over the document), so the
# hard 4KB Lambda env quota (#2375) stops being a deploy-failure class.
#
# IAM: the existing aws_iam_role_policy.lambda_ssm_read in main.tf already
# grants ssm:GetParameter on arn:...:parameter/thinkwork/<stage>/*, which
# covers this parameter, and aws_iam_role_policy.lambda_secrets covers the
# Secrets Manager reads — no new grants are needed here. R9's inline→managed
# consolidation happens in U6.
# ============================================================================

locals {
  # AWS Parameters and Secrets Lambda Extension — an AWS-managed public
  # layer whose publisher account id varies per region. Version 18 verified
  # in each listed region on 2026-06-11 (aws lambda get-layer-version-by-arn).
  # Regions not listed run without the layer: @thinkwork/runtime-config
  # falls back to a one-shot SDK GetParameter/GetSecretValue (R5), so this
  # map is an optimization, not a requirement. Bump the version here when
  # AWS retires old layer versions.
  parameters_secrets_extension_arns = {
    us-east-1 = "arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:18"
    us-east-2 = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:18"
    us-west-1 = "arn:aws:lambda:us-west-1:997803712105:layer:AWS-Parameters-and-Secrets-Lambda-Extension:18"
    us-west-2 = "arn:aws:lambda:us-west-2:345057560386:layer:AWS-Parameters-and-Secrets-Lambda-Extension:18"
    eu-west-1 = "arn:aws:lambda:eu-west-1:015030872274:layer:AWS-Parameters-and-Secrets-Lambda-Extension:18"
  }

  parameters_secrets_extension_arn = var.parameters_secrets_extension_layer_arn != "" ? var.parameters_secrets_extension_layer_arn : lookup(local.parameters_secrets_extension_arns, var.region, "")

  api_handler_layers = local.parameters_secrets_extension_arn != "" ? [local.parameters_secrets_extension_arn] : []

  # The document body: config-class common env + graphql-http's config-class
  # extras. Secrets and identity never enter this map (R4) — it is a plain
  # String parameter visible to anyone with ssm:GetParameter.
  runtime_config_document = merge(
    local.config_env,
    local.graphql_http_config_env,
  )
}

# ----------------------------------------------------------------------------
# Platform secrets (plan 2026-06-11-006 U5/R4)
#
# API_AUTH_SECRET and APPSYNC_API_KEY leave plaintext Lambda env: the
# runtime-config loader prefetches these at cold start (getApiAuthSecret /
# getAppsyncApiKey accessors, env-wins during the transition window). Names
# use the `thinkwork/${stage}/...` prefix so the shared role's existing
# `secretsmanager:GetSecretValue` grant on `thinkwork/*` covers them.
# The env copies in common_env are dropped one release AFTER this ships
# (R8 two-release transition) so mid-apply old-code containers never lose
# their env copy before the prefetch path exists.
# ----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "api_auth" {
  name        = "thinkwork/${var.stage}/api-auth"
  description = "Shared service-auth Bearer secret between platform services. Prefetched at Lambda cold start by @thinkwork/runtime-config."
  tags = {
    Name  = "thinkwork-${var.stage}-api-auth"
    Stage = var.stage
  }
}

resource "aws_secretsmanager_secret_version" "api_auth" {
  secret_id     = aws_secretsmanager_secret.api_auth.id
  secret_string = var.api_auth_secret

  # Operator rotations via console/CLI shouldn't be clobbered on apply —
  # same pattern as oauth-secrets.tf.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "appsync_api_key" {
  name        = "thinkwork/${var.stage}/appsync-api-key"
  description = "AppSync API key for subscription notify fan-out. Prefetched at Lambda cold start by @thinkwork/runtime-config."
  tags = {
    Name  = "thinkwork-${var.stage}-appsync-api-key"
    Stage = var.stage
  }
}

resource "aws_secretsmanager_secret_version" "appsync_api_key" {
  secret_id     = aws_secretsmanager_secret.appsync_api_key.id
  secret_string = var.appsync_api_key

  # AppSync keys are terraform-rotated (the appsync module recreates them),
  # so track the var here — unlike api_auth there is no operator rotation
  # path outside terraform.
}

resource "aws_ssm_parameter" "runtime_config" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name = "/thinkwork/${var.stage}/runtime-config"
  type = "String"
  # Advanced tier raises the value ceiling from 4KB (which would rebuild the
  # exact quota we are escaping) to 8KB, at ~$0.05/mo per stage.
  tier  = "Advanced"
  value = jsonencode(local.runtime_config_document)

  lifecycle {
    precondition {
      # Growth surfaces at plan time in CI, not as a runtime incident in a
      # customer account. If this ever trips, split the document by concern
      # — the loader's document-merge seam is the extension point.
      condition     = length(jsonencode(local.runtime_config_document)) < 7168
      error_message = "runtime-config document exceeds the 7KB plan-time ceiling (8KB advanced-tier hard limit). Split the document or prune keys — do not raise this limit casually."
    }
  }

  tags = {
    Name = "thinkwork-${var.stage}-runtime-config"
  }
}
