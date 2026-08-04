# PostgreSQL Database Module

Creates a PostgreSQL database for Thinkwork. Supports two engines selectable by stage — use cheaper RDS for dev/test and Aurora Serverless for production.

## Engines

| Engine | `database_engine` value | Best for | Deletion protection | Typical deploy time |
|--------|------------------------|----------|--------------------|--------------------|
| **Aurora Serverless v2** | `aurora-serverless` | Production. Auto-scales 0.5–2 ACU by default. | ON by default | ~6 min |
| **Standard RDS PostgreSQL** | `rds-postgres` | Dev/test. Single `db.t4g.micro` instance, 20 GB. | OFF by default | ~5 min |

Both engines share the same output interface — downstream modules don't need to know which is running.

## Usage

### Aurora (production)

```hcl
module "database" {
  source = "thinkwork-ai/thinkwork/aws//modules/data/aurora-postgres"

  stage       = "prod"
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.public_subnet_ids
  db_password = var.db_password

  database_engine = "aurora-serverless"
  min_capacity    = 0.5
  max_capacity    = 4
}
```

### RDS (dev/test)

```hcl
module "database" {
  source = "thinkwork-ai/thinkwork/aws//modules/data/aurora-postgres"

  stage       = "dev"
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.public_subnet_ids
  db_password = var.db_password

  database_engine    = "rds-postgres"
  rds_instance_class = "db.t4g.micro"
}
```

### BYO (existing database)

```hcl
module "database" {
  source = "thinkwork-ai/thinkwork/aws//modules/data/aurora-postgres"

  stage           = "prod"
  create_database = false

  existing_db_cluster_arn        = "arn:aws:rds:us-east-1:123456789012:cluster:my-cluster"
  existing_db_secret_arn         = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-db-creds"
  existing_db_endpoint           = "my-cluster.cluster-abc123.us-east-1.rds.amazonaws.com"
  existing_db_security_group_id  = "sg-0123456789abcdef0"
}
```

## Variables

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `stage` | string | — | Deployment stage (required) |
| `database_engine` | string | `"aurora-serverless"` | `aurora-serverless` or `rds-postgres` |
| `create_database` | bool | `true` | Set `false` for BYO |
| `vpc_id` | string | `""` | VPC ID (required when creating) |
| `subnet_ids` | list(string) | `[]` | Subnet IDs (required when creating) |
| `db_password` | string | `""` | Master password (required when creating) |
| `database_name` | string | `"thinkwork"` | Database name |
| `engine_version` | string | `"15.10"` | PostgreSQL version |
| `min_capacity` | number | `0.5` | Aurora min ACU (aurora-serverless only) |
| `max_capacity` | number | `2` | Aurora max ACU (aurora-serverless only) |
| `rds_instance_class` | string | `"db.t4g.micro"` | RDS instance class (rds-postgres only) |
| `rds_allocated_storage` | number | `20` | Storage in GB (rds-postgres only) |
| `deletion_protection` | bool | `null` | Auto: `true` for Aurora, `false` for RDS |

## Outputs

| Name | Description |
|------|-------------|
| `cluster_endpoint` | Database hostname |
| `db_cluster_arn` | Database ARN |
| `graphql_db_secret_arn` | Secrets Manager ARN for credentials |
| `db_security_group_id` | Security group ID |
| `database_url` | Full connection string (sensitive) |
| `database_engine` | Which engine is running |
