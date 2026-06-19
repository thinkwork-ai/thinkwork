# n8n Terraform Module

This module provisions the optional n8n managed-application runtime for
ThinkWork.

It creates:

- A public HTTPS ALB for the n8n editor/webhook runtime.
- One ECS/Fargate main service and one ECS/Fargate worker service.
- A managed ElastiCache Valkey/Redis replication group for queue mode.
- A retained S3 bucket or prefix for managed exports, package artifacts,
  evidence, and optional future storage mode objects.
- CloudWatch log groups, task/execution IAM roles, task security groups, and
  Aurora ingress from the n8n tasks.
- Secret references for the dedicated database credential, `N8N_ENCRYPTION_KEY`,
  the shared native operator account, and the tenant service credential used by
  the native n8n MCP integration.

The runtime is deliberately parked by desired count. Set
`runtime_enabled = false` to keep the database, cache, bucket, secrets, and ALB
while stopping the n8n ECS services.

## Storage Mode

THNK-50 targets the self-hosted OSS n8n runtime. In queue mode, n8n workers do
not support local filesystem binary storage, and n8n's S3/external execution
storage is enterprise-gated. The default therefore stays honest:

```hcl
execution_data_storage_mode = "database"
binary_data_mode            = "database"
```

The module still provisions S3 because ThinkWork needs retained package,
evidence, export/import, and future storage artifacts. Licensed deployments can
set the two storage-mode variables to `s3` after the deployment plan records the
license/edition decision.

## Database Lifecycle

Terraform does not create the `thinkwork_n8n` database directly. The
managed-application setup step must use `database_admin_secret_arn` to create the
dedicated database/role and write `database_url_secret_arn` before runtime
starts. The runtime secret must contain these JSON fields:

```json
{
  "DATABASE_URL": "postgresql://thinkwork_n8n:...@host:5432/thinkwork_n8n?sslmode=require",
  "DB_POSTGRESDB_PASSWORD": "..."
}
```

Destroy must run the inverse managed-app pre-destroy step to inventory storage,
terminate sessions, and drop the dedicated database and role after Terraform
parks or removes the services.

## Secrets

Required runtime secrets:

- `database_url_secret_arn`: `DATABASE_URL` and `DB_POSTGRESDB_PASSWORD`
- `encryption_key_secret_arn`: `N8N_ENCRYPTION_KEY`
- `operator_secret_arn`: `N8N_OPERATOR_EMAIL` and `N8N_OPERATOR_PASSWORD`
- `service_credential_secret_arn`: `N8N_MCP_SERVICE_CREDENTIAL`

`create_secret_placeholders = true` can create generated placeholders for
fixtures or bootstrap flows. Production installs should pass real secret ARNs
prepared by the managed-application workflow.

## Custom Packages

`custom_package_specs` accepts exact public npm package specs such as
`lodash@4.17.21` or `@scope/package@1.2.3`. The pinned specs are preserved for
image-build evidence, while the runtime derives package names for
`NODE_FUNCTION_ALLOW_EXTERNAL` so n8n Code nodes can import the installed
packages.

## Example

```hcl
module "n8n" {
  source = "../../../plugins/n8n/terraform/n8n"

  stage                = var.stage
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.public_subnet_ids
  cache_subnet_ids     = module.vpc.private_subnet_ids
  db_security_group_id = module.database.db_security_group_id
  database_host        = module.database.cluster_endpoint

  public_url      = "https://n8n.example.com"
  certificate_arn = aws_acm_certificate_validation.n8n.certificate_arn
  image_uri       = "123456789012.dkr.ecr.us-east-1.amazonaws.com/n8n@sha256:..."

  database_admin_secret_arn     = module.database.graphql_db_secret_arn
  database_url_secret_arn       = aws_secretsmanager_secret.n8n_database.arn
  encryption_key_secret_arn     = aws_secretsmanager_secret.n8n_encryption.arn
  operator_secret_arn           = aws_secretsmanager_secret.n8n_operator.arn
  service_credential_secret_arn = aws_secretsmanager_secret.n8n_service.arn
  storage_bucket_name           = "thinkwork-dev-n8n"
  runtime_enabled               = true
}
```
