# Twenty CRM App Module

This module provisions the optional Twenty CRM managed application substrate for
ThinkWork. It follows the Cognee optional-app shape but uses a public HTTPS ALB,
separate ECS services for the Twenty server and worker, a dedicated PostgreSQL
database URL injected from Secrets Manager, EFS for local server storage, and
ElastiCache for Valkey/Redis OSS.

The parent ThinkWork module owns whether this module is instantiated. Once it is
instantiated, `runtime_enabled = false` parks the ECS server and worker at
desired count zero while retaining the database secret references, EFS storage,
ElastiCache configuration, log groups, and re-enable path.

## Required Inputs

- `stage`
- `vpc_id`
- `subnet_ids`
- `db_security_group_id`
- `public_url`
- `certificate_arn`
- `image_uri`
- `db_url_secret_arn` or `create_secret_placeholders = true`
- `encryption_key_secret_arn` or `create_secret_placeholders = true`

`image_uri` must be pinned to an immutable `@sha256:` digest.

## Secrets

Twenty requires infrastructure-level secrets in environment variables:

- `PG_DATABASE_URL`
- `ENCRYPTION_KEY`
- optional `FALLBACK_ENCRYPTION_KEY`
- optional `APP_SECRET`
- optional `EMAIL_SMTP_USER`
- optional `EMAIL_SMTP_PASSWORD`

The module injects these values through ECS secrets. It never places database
credentials, encryption keys, or SMTP credentials into plaintext task-definition
environment values. Placeholder secret containers can be created for early
wiring, but the real values are expected to be created or rotated by the
deployment workflow.

## Email

When `email_from_address` is set, the module configures Twenty app email through
ThinkWork-owned SES SMTP:

- `EMAIL_DRIVER=SMTP`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`
- `EMAIL_SMTP_HOST`
- `EMAIL_SMTP_PORT`
- `EMAIL_SMTP_NO_TLS`
- `EMAIL_SMTP_USER`
- `EMAIL_SMTP_PASSWORD`

The composite ThinkWork module derives `email_from_address` from
`noreply@<ses_inbound_domain>` by default, so invitation and workspace emails
work when the existing ThinkWork SES identity is verified. The SMTP username and
password are generated as a least-privilege IAM access key, stored in Secrets
Manager, and injected into both the Twenty server and worker containers.

## Admin Panel Configuration

The module sets `IS_CONFIG_VARIABLES_IN_DB_ENABLED=true` on both the Twenty
server and worker containers. Twenty uses that mode to store Admin Panel
configuration variables in the dedicated CRM database, so settings such as model
provider keys, messaging providers, and storage options can be edited from the
Twenty UI after deployment. Infrastructure settings like `PG_DATABASE_URL`,
`SERVER_URL`, encryption keys, and Terraform-managed email delivery settings
remain environment-only.

## Logic Functions

The module sets `LOGIC_FUNCTION_TYPE=LOCAL` on both the Twenty server and worker
containers so first-party native apps can install and run trusted workflow
actions such as the ThinkWork Webhook. Twenty disables logic functions by
default in production; without this setting, native app install fails before the
workflow action can be created.

## Cache

The default cache engine is Valkey because it is the lower-cost
Redis-compatible ElastiCache engine. The cache is placed in `cache_subnet_ids`
when supplied, with ingress restricted to the Twenty ECS task security group.

## Runtime Lifecycle

| `runtime_enabled` | Server desired count   | Worker desired count   | Retained resources                   |
| ----------------- | ---------------------- | ---------------------- | ------------------------------------ |
| `true`            | `server_desired_count` | `worker_desired_count` | All resources                        |
| `false`           | `0`                    | `0`                    | EFS, ElastiCache, secrets, logs, ALB |

Destroying retained CRM data is intentionally outside the settings-toggle v1
lifecycle.
