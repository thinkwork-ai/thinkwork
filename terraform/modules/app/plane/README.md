# Plane App Module

This module provisions the optional Plane managed application substrate for
ThinkWork. The Plane runtime topology is intentionally compact:

- public HTTPS ALB for the Plane web service
- one ECS/Fargate service running the Plane all-in-one container, plus the
  Plane MCP sidecar needed for ThinkWork agent access
- in-task loopback Redis and RabbitMQ sidecars, because the upstream Plane AIO
  image still requires `REDIS_URL` and `AMQP_URL`
- S3 for Plane file uploads and attachments
- CloudWatch log groups for the Plane AIO and MCP containers
- Secrets Manager references for database, app, and S3 credentials

Do not add separately managed Redis/Valkey, RabbitMQ/Amazon MQ, or per-service
Plane ECS services to this module. The accepted v1 shape is one ECS service,
one task definition, and four containers: `plane-app`, `plane-mcp`,
`plane-redis`, and `plane-rabbitmq`. Redis and RabbitMQ must remain private to
the task; they are not separately managed infrastructure.

The parent ThinkWork module owns whether this module is instantiated. Once it is
instantiated, `runtime_enabled = false` parks the compact Plane ECS service at desired
count zero while retaining the database secret references, S3 bucket/objects,
log groups, ALB, and re-enable path.

## Required Inputs

- `stage`
- `vpc_id`
- `subnet_ids`
- `db_security_group_id`
- `public_url`
- `certificate_arn`
- `image_uri` (Plane all-in-one image)
- `mcp_image_uri`
- `s3_bucket_name`
- `db_url_secret_arn` or `create_secret_placeholders = true`
- `secret_key_secret_arn` or `create_secret_placeholders = true`
- `live_server_secret_key_secret_arn` or `create_secret_placeholders = true`
- `aes_secret_key_secret_arn` or `create_secret_placeholders = true`
- `s3_access_key_id_secret_arn` or `create_secret_placeholders = true`
- `s3_secret_access_key_secret_arn` or `create_secret_placeholders = true`

`image_uri` must be pinned to an immutable `@sha256:` digest.

## Secrets

Plane requires infrastructure-level secrets in environment variables:

- `DATABASE_URL`
- `SECRET_KEY`
- `LIVE_SERVER_SECRET_KEY`
- `AES_SECRET_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `REDIS_URL` (generated as task-local loopback)
- `AMQP_URL` (generated as task-local loopback)

The module injects these values through ECS secrets. It never places database
URLs, app secrets, or S3 credentials into plaintext task-definition
environment values. Placeholder secret containers can be created for early
wiring, but real values are expected to be created or rotated by the deployment
workflow.

## Runtime Lifecycle

| `runtime_enabled` | Compact ECS service | Retained resources               |
| ----------------- | ------------------- | -------------------------------- |
| `true`            | `web_desired_count` | All resources                    |
| `false`           | `0`                 | Database, S3, secrets, logs, ALB |

Destroying retained Plane data is intentionally separate from parking. A
destructive deployment job must inventory/drop the dedicated database, storage
objects, and secrets explicitly before the Terraform substrate is removed.
