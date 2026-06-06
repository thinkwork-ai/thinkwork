---
title: "Twenty CRM invitations need SES SMTP configuration at deployment time"
date: 2026-06-06
category: integration-issues
module: twenty-managed-app
problem_type: integration_issue
component: email_processing
symptoms:
  - "Twenty CRM users can reach the app and sign in, but invited members do not receive invitation emails."
  - "Twenty Admin Panel shows EMAIL_DRIVER as LOGGER and EMAIL_SMTP_HOST, EMAIL_SMTP_USER, and EMAIL_SMTP_PASSWORD as null."
  - "Some Admin Panel config rows show Database configuration is currently disabled because the value is environment-owned."
  - "ECS task definitions for Twenty server and worker do not include EMAIL_* environment variables or SMTP secrets."
root_cause: config_error
resolution_type: config_change
severity: high
related_components:
  - terraform
  - secrets-manager
  - ecs
  - ses
tags:
  - twenty-crm
  - ses
  - smtp
  - invitations
  - terraform
  - ecs
  - secrets-manager
  - admin-panel
---

# Twenty CRM invitations need SES SMTP configuration at deployment time

## Problem

The deployed Twenty CRM runtime was healthy enough for login and first-user setup, but workspace invitations did not deliver email. The deployment created the CRM service, database, cache, and storage, but never configured Twenty's app-email path, so invitation email stayed on Twenty's default logger/null SMTP settings.

## Symptoms

- The Twenty Admin Panel email settings showed `EMAIL_DRIVER=LOGGER`, `EMAIL_FROM_ADDRESS=noreply@yourdomain...`, and null SMTP host/user/password.
- Attempts to configure some values in the Admin Panel showed "Database configuration is currently disabled. Value is set in the server environment, it may be a different value on the worker."
- ECS task definitions for `thinkwork-dev-twenty-server` and `thinkwork-dev-twenty-worker` only had core runtime env such as `SERVER_URL`, `PG_DATABASE_URL`, `ENCRYPTION_KEY`, and `IS_CONFIG_VARIABLES_IN_DB_ENABLED`; no `EMAIL_*` values were present.
- The app health check still returned 200 and login worked, so the broken invitation path was easy to miss.

## What Didn't Work

- Treating CRM login or `/healthz` as proof that the deployment was complete. Those checks prove the web/runtime path, not app-email delivery. The earlier end-to-end CRM verification covered deploy, park, redeploy, and destroy, but did not include inviting another member (session history).
- Expecting `IS_CONFIG_VARIABLES_IN_DB_ENABLED=true` to automatically configure email. It only allows DB-backed Admin Panel config; it does not seed `EMAIL_DRIVER`, SMTP host, sender, or credentials.
- Relying on manual Admin Panel edits for all settings. Some config values can be environment-owned and non-editable from the UI, and server and worker can disagree if only one side receives the values.
- Configuring only the server container. Twenty background jobs can send app emails, so the worker needs the same `EMAIL_*` contract as the server.

## Solution

Fix the live stage first, then make Terraform own the deployment path.

### Live remediation

For the current dev deployment, the fix was to provision SES SMTP credentials and write DB-backed Twenty config rows:

- Created a least-privilege IAM SMTP user for Twenty app email.
- Granted `ses:SendEmail` and `ses:SendRawEmail` for SES identities/configuration sets in `us-east-1`.
- Derived the SES SMTP password from the access key.
- Inserted/updated `core."keyValuePair"` rows with `type='CONFIG_VARIABLE'`:
  - `EMAIL_DRIVER = "SMTP"`
  - `EMAIL_FROM_ADDRESS = "noreply@agents.thinkwork.ai"`
  - `EMAIL_FROM_NAME = "ThinkWork CRM"`
  - `EMAIL_SMTP_HOST = "email-smtp.us-east-1.amazonaws.com"`
  - `EMAIL_SMTP_NO_TLS = false`
  - `EMAIL_SMTP_PORT = 587`
  - `EMAIL_SMTP_USER = encrypted`
  - `EMAIL_SMTP_PASSWORD = encrypted`
- Restarted both Twenty ECS services with `--force-new-deployment`.
- Verified both services were stable and `https://crm.thinkwork.ai/healthz` returned `200`.

Do not store the SMTP username/password as plaintext DB values. Twenty encrypts sensitive config values using its instance encryption key; the live repair used the same `enc:v2` envelope that Twenty expects.

### Terraform deployment fix

The durable fix is PR #2182, merge commit `955a2d2e0`, which made the Twenty app module configure SES SMTP whenever `email_from_address` is set.

The app module now derives an SMTP host from the AWS region and injects non-secret email config into both server and worker environments:

```hcl
smtp_enabled = var.email_from_address != ""
smtp_host    = var.email_smtp_host != "" ? var.email_smtp_host : "email-smtp.${data.aws_region.current.name}.amazonaws.com"

email_environment = local.smtp_enabled ? [
  { name = "EMAIL_DRIVER", value = "SMTP" },
  { name = "EMAIL_FROM_ADDRESS", value = var.email_from_address },
  { name = "EMAIL_FROM_NAME", value = var.email_from_name },
  { name = "EMAIL_SMTP_HOST", value = local.smtp_host },
  { name = "EMAIL_SMTP_NO_TLS", value = tostring(var.email_smtp_no_tls) },
  { name = "EMAIL_SMTP_PORT", value = tostring(var.email_smtp_port) },
] : []
```

The SMTP credentials are generated through Terraform and injected as ECS secrets, not plaintext task env:

```hcl
resource "aws_iam_access_key" "ses_smtp" {
  count = local.smtp_enabled ? 1 : 0

  user = aws_iam_user.ses_smtp[0].name
}

resource "aws_secretsmanager_secret_version" "ses_smtp" {
  count = local.smtp_enabled ? 1 : 0

  secret_id = aws_secretsmanager_secret.ses_smtp[0].id
  secret_string = jsonencode({
    EMAIL_SMTP_USER     = aws_iam_access_key.ses_smtp[0].id
    EMAIL_SMTP_PASSWORD = aws_iam_access_key.ses_smtp[0].ses_smtp_password_v4
  })
}
```

Both containers receive the credential secret:

```hcl
local.smtp_enabled ? [
  { name = "EMAIL_SMTP_USER", valueFrom = "${aws_secretsmanager_secret.ses_smtp[0].arn}:EMAIL_SMTP_USER::" },
  { name = "EMAIL_SMTP_PASSWORD", valueFrom = "${aws_secretsmanager_secret.ses_smtp[0].arn}:EMAIL_SMTP_PASSWORD::" },
] : []
```

The composite ThinkWork module derives the default sender from the existing ThinkWork SES domain:

```hcl
twenty_email_domain = var.twenty_email_domain != "" ? var.twenty_email_domain : var.ses_inbound_domain
twenty_email_from_address = (
  var.twenty_email_from_address != ""
  ? var.twenty_email_from_address
  : local.twenty_email_domain != "" ? "noreply@${local.twenty_email_domain}" : ""
)
```

This keeps greenfield deploys simple: when `ses_inbound_domain` is set to a verified SES identity such as `agents.thinkwork.ai`, Twenty gets `noreply@agents.thinkwork.ai` automatically.

## Why This Works

Twenty has two relevant config paths:

- `IS_CONFIG_VARIABLES_IN_DB_ENABLED=true` lets Admin Panel config live in the CRM database.
- Environment variables still override or own infrastructure-level config when present.

The original deployment enabled DB-backed config but did not populate email config through either path. Twenty therefore used defaults: logging instead of SMTP and null SMTP credentials.

The Terraform fix moves email delivery into the deployment contract:

- The server and worker get the same `EMAIL_*` values.
- SES SMTP credentials are created with least-privilege IAM permissions.
- Credentials are stored in Secrets Manager and injected through ECS secrets.
- The sender is derived from a ThinkWork-managed, verified SES identity.
- Structural fixture tests assert the app module, composite module, greenfield example, init template, enterprise template, and deployment-runner all carry the fields.

The tradeoff is intentional: future Terraform-managed email values are environment-owned, so the Twenty Admin Panel may show them as non-editable. That is preferable for the app-email path because invitations should work immediately after deploy and should not depend on someone manually editing each stage.

## Prevention

- Include an invitation-email smoke in CRM readiness checks. Login plus `/healthz` is not enough for app-email delivery.
- Keep server and worker `EMAIL_*` wiring symmetrical. Any future config added to `email_environment` should be present in both `server_environment` and `worker_environment`.
- Preserve the structural fixture test in `apps/cli/__tests__/terraform-twenty-fixture.test.ts`. It checks:
  - `EMAIL_DRIVER=SMTP`
  - SES SMTP host/port/no-TLS env values
  - `EMAIL_SMTP_USER` and `EMAIL_SMTP_PASSWORD` ECS secret injection
  - Terraform-created IAM SMTP user/access key/Secrets Manager secret
  - composite-module derivation from `ses_inbound_domain`
  - greenfield/init/enterprise/deployment-runner pass-through
- When manually hotfixing Twenty config, inspect both ECS task definitions and the CRM DB `core."keyValuePair"` config rows. Either path can explain what the Admin Panel shows.
- Force a new ECS deployment after changing runtime config so both containers restart on the intended task definition and cached process config is cleared.

## Related Issues

- PR #2182: `fix: configure Twenty CRM email via SES`
- [OAuth client credentials in AWS Secrets Manager](../best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md) — related credential-hygiene pattern for Secrets Manager, with a different Terraform-state tradeoff.
- [ECS Exec existing tasks need force-new-deployment](../runtime-errors/ecs-exec-existing-tasks-need-force-new-deployment-2026-05-13.md) — adjacent operational lesson: service-level changes do not always affect already-running ECS tasks.
- [apply_invocation_env subset-dict drops per-invocation fields](../patterns/apply-invocation-env-field-passthrough-2026-04-24.md) — related prevention theme: env/config fields need explicit pass-through tests.
