# Kestra Module (optional managed orchestration app)

This module provisions the optional Kestra managed application substrate for
ThinkWork. It runs Kestra OSS on ECS/Fargate behind a public HTTPS Application
Load Balancer, uses a dedicated PostgreSQL database/user for repository and
queue state, stores internal files in an encrypted S3 bucket, and injects
database plus UI/API basic-auth credentials through ECS secrets.

The parent ThinkWork module owns whether this module is instantiated. Once it is
instantiated, `runtime_enabled = false` parks the ECS service at desired count
zero while retaining the database reference, S3 bucket, Secrets Manager
references, ALB, log group, and re-enable path.

## Required Inputs

- `stage`
- `vpc_id`
- `subnet_ids`
- `db_security_group_id`
- `db_host`
- `public_url`
- `certificate_arn`
- `image_uri`
- `db_password_secret_arn` or `create_secret_placeholders = true`
- `basic_auth_secret_arn` or `create_secret_placeholders = true`

`image_uri` must be pinned to an immutable `@sha256:` digest. The selected image
must include the Kestra S3 storage backend expected by this module.

## Secrets

Sensitive values enter the ECS task through the `secrets` block, not normal
environment values:

- `KESTRA_DB_PASSWORD` is read from `db_password_secret_arn` JSON key
  `password`.
- `KESTRA_BASIC_AUTH_USERNAME` is read from `basic_auth_secret_arn` JSON key
  `username`.
- `KESTRA_BASIC_AUTH_PASSWORD` is read from `basic_auth_secret_arn` JSON key
  `password`.

The generated `KESTRA_CONFIGURATION` environment value references those secret
environment variables. It does not contain secret material.

The module accepts pre-existing secret ARNs by default. For deployments that
want Terraform to create the secret containers, set
`create_secret_placeholders = true`. Terraform then creates only missing secret
containers:

- `thinkwork/{stage}/kestra/db-password`
- `thinkwork/{stage}/kestra/basic-auth`

Secret versions are seeded with `PLACEHOLDER_SET_VIA_CI` and use
`lifecycle.ignore_changes = [secret_string]`. Operators populate or rotate real
values with Secrets Manager after creation, and later Terraform applies do not
clobber those values.

## Database

Kestra is configured with:

- `kestra.repository.type = postgres`
- `kestra.queue.type = postgres`
- `datasources.postgres.url = jdbc:postgresql://<db_host>:<db_port>/<db_name>`

Use a dedicated Kestra database and least-privilege role. Do not point this
module at the shared ThinkWork application schema or an Aurora admin/master
credential. The module rejects common admin usernames such as `postgres`,
`thinkwork_admin`, and `rdsadmin`.

## Storage

Kestra internal storage is configured as S3:

- `kestra.storage.type = s3`
- `kestra.storage.s3.region = <current AWS region>`
- `kestra.storage.s3.bucket = <module bucket>`

This follows Kestra's AWS guidance for durable internal storage in non-local
deployments. The ECS task role receives least-privilege access to the bucket and
no static S3 access keys are injected.

## Runtime Boundaries

V1 deliberately uses a single Kestra standalone ECS task. Keep `desired_count =
1` until a follow-up splits server, worker, executor, scheduler, and webserver
roles explicitly.

The module does not mount `/var/run/docker.sock`, does not run privileged
containers, and does not add Docker-in-Docker sidecars or EC2 capacity. Kestra
flows that require Docker socket access, arbitrary host containers, or privileged
execution are outside the v1 Fargate runtime contract.

ThinkWork agents should treat this module as the managed customer runtime, not
as a general host executor. Public Kestra catalog/docs MCP tools may be useful
for plugin discovery, but customer flow validation, upsert, execution, and log
inspection go through ThinkWork's managed `/mcp/kestra` control endpoint.

## Runtime Lifecycle

| `runtime_enabled` | ECS desired count | Retained resources                        |
| ----------------- | ----------------- | ----------------------------------------- |
| `true`            | `desired_count`   | All resources                             |
| `false`           | `0`               | S3, DB refs, secrets, logs, ALB, IAM, SGs |

Destroying retained orchestration data is intentionally destructive. It removes
the S3 bucket when `storage_force_destroy = true`, database references, secret
containers owned by this module, log groups, and runtime infrastructure.

Destroy also expects the parent managed-app lifecycle to remove the app-owned
Kestra control MCP row, bearer token material, secret references, and runtime
configuration. Parking retains those so a later deploy can reuse the same
managed control path.

## Health And Smoke Expectations

The public ALB routes UI/API traffic to port `8080`. ALB health checks use the
management `/health` endpoint on port `8081`, matching Kestra's documented
management endpoint behavior.

Terraform validation proves syntax and dependency wiring. After enabling Kestra
in a stage, operators should also verify:

- `kestra_runtime_enabled` is `true`.
- `kestra_url` resolves to the expected HTTPS origin.
- the target group reports healthy targets.
- `node scripts/smoke/kestra-managed-app-smoke.mjs` skips cleanly for
  unprovisioned or parked stages.
- the live managed-app smoke proves a running stage exposes an HTTPS endpoint
  that returns success or an authentication challenge:
  `SMOKE_ENABLE_KESTRA_MANAGED_APP=1 node scripts/smoke/kestra-managed-app-smoke.mjs`.
- the live control MCP smoke proves the managed endpoint lists the curated
  tools, accepts a Fargate-safe flow, rejects an unsupported Docker task, and
  can upsert/start/poll a safe smoke flow unless `SMOKE_KESTRA_CONTROL_MUTATE=0`
  is set:
  `SMOKE_ENABLE_KESTRA_CONTROL_MCP=1 node scripts/smoke/kestra-control-mcp-smoke.mjs`.

After destructive destroy, the expected proof is that managed-app status reports
Kestra unprovisioned, the managed-app smoke skips explicitly, and the Kestra
Control MCP row/token/configuration are gone.
