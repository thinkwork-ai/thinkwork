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

The module injects these values through ECS secrets. It never places database
credentials or encryption keys into plaintext task-definition environment
values. Placeholder secret containers can be created for early wiring, but the
real values are expected to be created or rotated by the deployment workflow.

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
