################################################################################
# Per-user OAuth client credentials (Google Workspace, Microsoft 365)
#
# Stored in Secrets Manager as JSON blobs `{"client_id","client_secret"}`.
# Fetched by oauth-authorize, oauth-callback, oauth-token at Lambda cold-start
# via packages/api/src/lib/oauth-client-credentials.ts, which caches values in
# module scope so warm containers pay zero additional round-trips.
#
# Secret names use the existing `thinkwork/${stage}/...` prefix so the shared
# Lambda role's `secretsmanager:GetSecretValue` policy on `thinkwork/*`
# (main.tf:128-135) covers them — no new IAM attachment needed.
#
# Security posture vs. the prior common_env env-var approach: client secrets
# are no longer baked into Lambda configuration (invisible in
# `aws lambda get-function-configuration`, in CloudWatch event streams, and
# in terraform state for the Lambda resource). The secret value itself is
# still readable by any Lambda using the shared role — per-consumer-role
# scoping is a separate (larger) refactor tracked for prod.
################################################################################

resource "aws_secretsmanager_secret" "oauth_google_productivity" {
  name        = "thinkwork/${var.stage}/oauth/google-productivity"
  description = "Google Workspace OAuth client credentials (per-user Gmail/Calendar integration). Fetched at Lambda cold-start by oauth-client-credentials.ts."
  tags = {
    Name     = "thinkwork-${var.stage}-oauth-google-productivity"
    Stage    = var.stage
    Provider = "google_productivity"
  }
}

resource "aws_secretsmanager_secret_version" "oauth_google_productivity" {
  secret_id = aws_secretsmanager_secret.oauth_google_productivity.id
  secret_string = jsonencode({
    client_id     = var.google_oauth_client_id
    client_secret = var.google_oauth_client_secret
  })

  # If the operator rotates the secret via AWS console / CLI without touching
  # tfvars, terraform shouldn't clobber it on next apply. Matches the pattern
  # used for google_places_api_key in the wiki-compile handler.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Microsoft 365 deferred to a follow-up — needs Azure app registration first.
# When ready, mirror the google-productivity resources + add
# `microsoft_oauth_client_id` / `_secret` variables to this module and the
# thinkwork module, then add MICROSOFT_OAUTH_SECRET_ARN to common_env.
