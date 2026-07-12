################################################################################
# Microsoft Teams app credentials
#
# Stored in Secrets Manager as a JSON blob with two fields:
#
#   {
#     "app_id":        "Teams (Entra) app registration / bot app id",
#     "client_secret": "Entra app client secret"
#   }
#
# The Teams install + account-link handlers receive only this secret ARN in
# Lambda configuration. The client_secret doubles as the HMAC signing key for
# install state and account-link tokens — transport-only material that must
# never appear in logs or responses. The shared Lambda role already has
# access to the `thinkwork/*` prefix, so no additional IAM attachment is
# needed (same as the Slack app credentials secret).
#
# Operators populate the real value out-of-band. Terraform creates an initial
# empty version so Lambdas fail with a clear missing-field error before setup,
# and lifecycle.ignore_changes prevents later applies from overwriting rotated
# credentials.
################################################################################

resource "aws_secretsmanager_secret" "msteams_app_credentials" {
  count       = var.enable_msteams_app ? 1 : 0
  name        = "thinkwork/${var.stage}/msteams/app"
  description = "Microsoft Teams app credentials (app_id, client_secret). Populate via Secrets Manager; never via tfvars."
  tags = {
    Name     = "thinkwork-${var.stage}-msteams-app"
    Stage    = var.stage
    Provider = "msteams"
  }
}

resource "aws_secretsmanager_secret_version" "msteams_app_credentials_initial" {
  count     = var.enable_msteams_app ? 1 : 0
  secret_id = aws_secretsmanager_secret.msteams_app_credentials[0].id
  secret_string = jsonencode({
    app_id        = ""
    client_secret = ""
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
