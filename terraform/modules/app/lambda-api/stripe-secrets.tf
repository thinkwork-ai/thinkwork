################################################################################
# Stripe API credentials
#
# Stored in Secrets Manager as a JSON blob with three fields:
#
#   {
#     "secret_key":             "sk_test_... | sk_live_...",
#     "publishable_key":        "pk_test_... | pk_live_...",
#     "webhook_signing_secret": "whsec_..."
#   }
#
# Fetched at Lambda cold-start by packages/api/src/lib/stripe-credentials.ts,
# which caches values in module scope so warm containers pay zero additional
# round-trips. Secret name uses the existing `thinkwork/${stage}/...` prefix so
# the shared Lambda role's `secretsmanager:GetSecretValue` policy on
# `thinkwork/*` (main.tf) covers it — no new IAM attachment needed.
#
# Operator populates the secret value out-of-band (never via tfvars), so Stripe
# keys are absent from terraform state for this resource:
#
#   aws secretsmanager put-secret-value \
#     --secret-id thinkwork/${stage}/stripe/api-credentials \
#     --secret-string file://stripe-creds.json
#
# The initial version is a placeholder of empty strings so the secret has at
# least one version immediately after apply (Lambdas produce a clearer error
# shape when a field is empty than when the secret has zero versions).
################################################################################

resource "aws_secretsmanager_secret" "stripe_api_credentials" {
  name        = "thinkwork/${var.stage}/stripe/api-credentials"
  description = "Stripe API credentials (secret_key, publishable_key, webhook_signing_secret). Populate via `aws secretsmanager put-secret-value`; never via tfvars."
  tags = {
    Name     = "thinkwork-${var.stage}-stripe-api-credentials"
    Stage    = var.stage
    Provider = "stripe"
  }
}

resource "aws_secretsmanager_secret_version" "stripe_api_credentials_initial" {
  secret_id = aws_secretsmanager_secret.stripe_api_credentials.id
  secret_string = jsonencode({
    secret_key             = ""
    publishable_key        = ""
    webhook_signing_secret = ""
  })

  # Operator rotates via `aws secretsmanager put-secret-value`; terraform
  # should never clobber that value on subsequent applies.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
