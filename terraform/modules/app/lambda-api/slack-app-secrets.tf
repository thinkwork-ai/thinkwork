################################################################################
# Slack workspace app credentials
#
# Stored in Secrets Manager as a JSON blob with three fields:
#
#   {
#     "signing_secret": "Slack request signing secret",
#     "client_id":      "Slack OAuth client id",
#     "client_secret":  "Slack OAuth client secret"
#   }
#
# Slack request handlers and the OAuth install handler receive only this secret
# ARN in Lambda configuration. The shared Lambda role already has access to the
# `thinkwork/*` prefix, so no additional IAM attachment is needed.
#
# Operators populate the real value out-of-band. Terraform creates an initial
# empty version so Lambdas fail with a clear missing-field error before setup,
# and lifecycle.ignore_changes prevents later applies from overwriting rotated
# credentials.
################################################################################

resource "aws_secretsmanager_secret" "slack_app_credentials" {
  name        = "thinkwork/${var.stage}/slack/app"
  description = "Slack workspace app credentials (signing_secret, client_id, client_secret). Populate via Secrets Manager; never via tfvars."
  tags = {
    Name     = "thinkwork-${var.stage}-slack-app"
    Stage    = var.stage
    Provider = "slack"
  }
}

resource "aws_secretsmanager_secret_version" "slack_app_credentials_initial" {
  secret_id = aws_secretsmanager_secret.slack_app_credentials.id
  secret_string = jsonencode({
    signing_secret = ""
    client_id      = ""
    client_secret  = ""
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
