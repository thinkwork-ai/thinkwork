################################################################################
# PostgreSQL Database — Data Module
#
# Supports two engines:
# - aurora-serverless: Aurora Serverless v2 (production, auto-scaling)
# - rds-postgres: Standard RDS PostgreSQL (dev/test, cheaper, single instance)
#
# Both share the same output interface so downstream modules don't care
# which engine is running. BYO support via create_database = false.
################################################################################

locals {
  create     = var.create_database
  use_aurora = local.create && var.database_engine == "aurora-serverless"
  use_rds    = local.create && var.database_engine == "rds-postgres"

  cluster_identifier = "thinkwork-${var.stage}-db"
  master_username    = "thinkwork_admin"

  # Deletion protection: default to true for Aurora, false for RDS
  deletion_protection = var.deletion_protection != null ? var.deletion_protection : (var.database_engine == "aurora-serverless")

  # Unified outputs regardless of engine
  db_cluster_arn = local.use_aurora ? aws_rds_cluster.main[0].arn : (
    local.use_rds ? aws_db_instance.main[0].arn : var.existing_db_cluster_arn
  )
  graphql_db_secret_arn = local.create ? aws_secretsmanager_secret.db_credentials[0].arn : var.existing_db_secret_arn
  cluster_endpoint = local.use_aurora ? aws_rds_cluster.main[0].endpoint : (
    local.use_rds ? aws_db_instance.main[0].address : var.existing_db_endpoint
  )
  db_security_group_id = local.create ? aws_security_group.db[0].id : var.existing_db_security_group_id

  # aws_s3 Aurora extension opts in when an Aurora cluster exists AND the
  # caller set enable_aws_s3 = true. Plan-time gate is the explicit bool,
  # not the backups_bucket_arn nullness — a freshly-created bucket's ARN
  # is "known after apply," which broke count evaluation on greenfield
  # deploys (see PR #526 for the incident). The ARN is still used inside
  # the IAM policy body (jsonencode interpolates at apply time, fine).
  # Non-aurora engines short-circuit before aws_rds_cluster.main[0] is
  # dereferenced.
  enable_aws_s3 = local.use_aurora && var.enable_aws_s3
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

################################################################################
# Security Group (shared by both engines)
################################################################################

resource "aws_security_group" "db" {
  count       = local.create ? 1 : 0
  description = "Security group for Thinkwork PostgreSQL database"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "PostgreSQL access"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "thinkwork-${var.stage}-db-sg"
  }

  lifecycle {
    ignore_changes = [name]
  }
}

################################################################################
# DB Subnet Group (shared by both engines)
################################################################################

resource "aws_db_subnet_group" "main" {
  count      = local.create ? 1 : 0
  name       = "thinkwork-${var.stage}-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "thinkwork-${var.stage}-db-subnet-group"
  }
}

################################################################################
# Aurora Serverless v2 (production engine)
################################################################################

resource "aws_rds_cluster" "main" {
  count = local.use_aurora ? 1 : 0

  cluster_identifier = local.cluster_identifier
  engine             = "aurora-postgresql"
  engine_version     = var.engine_version
  database_name      = var.database_name
  master_username    = local.master_username
  master_password    = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.db[0].id]

  enable_http_endpoint = true
  skip_final_snapshot  = true
  deletion_protection  = local.deletion_protection
  storage_encrypted    = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  tags = {
    Name = "thinkwork-${var.stage}-db"
  }
}

resource "aws_rds_cluster_instance" "main" {
  count = local.use_aurora ? 1 : 0

  identifier         = "thinkwork-${var.stage}-db-1"
  cluster_identifier = aws_rds_cluster.main[0].id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main[0].engine
  engine_version     = aws_rds_cluster.main[0].engine_version

  publicly_accessible  = true
  db_subnet_group_name = aws_db_subnet_group.main[0].name

  tags = {
    Name = "thinkwork-${var.stage}-db-1"
  }
}

################################################################################
# Standard RDS PostgreSQL (dev/test engine)
################################################################################

resource "aws_db_instance" "main" {
  count = local.use_rds ? 1 : 0

  identifier     = local.cluster_identifier
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.rds_instance_class
  db_name        = var.database_name
  username       = local.master_username
  password       = var.db_password

  allocated_storage     = var.rds_allocated_storage
  max_allocated_storage = var.rds_allocated_storage * 2
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.db[0].id]

  publicly_accessible = true
  skip_final_snapshot = true
  deletion_protection = local.deletion_protection

  tags = {
    Name = "thinkwork-${var.stage}-db"
  }
}

################################################################################
# aws_s3 extension IAM role (Aurora only; opt-in via backups_bucket_arn)
#
# Aurora Postgres ships with an `aws_s3` extension (CREATE EXTENSION IF NOT
# EXISTS aws_s3 CASCADE) that allows `aws_s3.query_export_to_s3(...)` to
# write query results directly to S3. It requires an IAM role associated
# with the cluster + trust for `rds.amazonaws.com` + `s3:PutObject`
# permission on the target bucket.
#
# When `backups_bucket_arn` is set, this block provisions the role, the
# policy, and the cluster association so that U5 of the thread-detail
# cleanup plan (packages/database-pg/drizzle/0027_thread_cleanup_drops.sql)
# can `SELECT aws_s3.query_export_to_s3(...)` without embedding any AWS
# credentials in the hand-rolled SQL.
#
# Post-deploy one-shot step (documented in the plan, not automated here):
#   psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE"
################################################################################

resource "aws_iam_role" "aurora_aws_s3" {
  count = local.enable_aws_s3 ? 1 : 0

  name = "thinkwork-${var.stage}-aurora-aws-s3"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "rds.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name    = "thinkwork-${var.stage}-aurora-aws-s3"
    Purpose = "aurora-aws_s3-extension"
  }
}

resource "aws_iam_role_policy" "aurora_aws_s3" {
  count = local.enable_aws_s3 ? 1 : 0

  name = "thinkwork-${var.stage}-aurora-aws-s3"
  role = aws_iam_role.aurora_aws_s3[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PutBackupObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:AbortMultipartUpload",
          # GetBucketLocation is required by aws_s3.query_export_to_s3 for the
          # region-matching check; without it exports fail at runtime with an
          # opaque permission error. AWS Aurora docs:
          # https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/postgresql-s3-export.html
          "s3:GetBucketLocation",
        ]
        # Object-level actions are scoped to pre-drop/* so this role can only
        # write snapshots produced by destructive migrations, not read or
        # overwrite arbitrary bucket content. GetBucketLocation applies to
        # the bucket ARN itself (it is a bucket-level, not object-level,
        # operation).
        Resource = [
          var.backups_bucket_arn,
          "${var.backups_bucket_arn}/pre-drop/*",
        ]
      },
    ]
  })
}

resource "aws_rds_cluster_role_association" "aurora_aws_s3" {
  count = local.enable_aws_s3 ? 1 : 0

  db_cluster_identifier = aws_rds_cluster.main[0].id
  feature_name          = "s3Export"
  role_arn              = aws_iam_role.aurora_aws_s3[0].arn

  # Force the inline policy to land before RDS validates the role. Terraform's
  # implicit dependency graph only links this resource to the IAM role itself
  # (via role_arn). RDS AddRoleToDBCluster verifies the trust policy + any
  # attached inline policies server-side; applying the association before the
  # policy has propagated can return AccessDenied on the first apply.
  depends_on = [aws_iam_role_policy.aurora_aws_s3]
}

################################################################################
# Secrets Manager — DB Credentials (shared by both engines)
################################################################################

resource "aws_secretsmanager_secret" "db_credentials" {
  count = local.create ? 1 : 0
  name  = "thinkwork-${var.stage}-db-credentials"

  tags = {
    Name = "thinkwork-${var.stage}-db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  count     = local.create ? 1 : 0
  secret_id = aws_secretsmanager_secret.db_credentials[0].id

  secret_string = jsonencode({
    username = local.master_username
    password = var.db_password
  })
}

################################################################################
# Secrets Manager — Compliance Role Credentials (Phase 3 U2)
#
# Three role-scoped secret containers for the compliance.* schema introduced
# in U1 (drizzle/0069_compliance_schema.sql, PR #880). Per Decision #4 of the
# master plan (docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md):
#
#   - compliance/writer-credentials:  used by Yoga resolvers + Lambda handlers
#                                     via the U3 emitAuditEvent helper.
#   - compliance/drainer-credentials: used by the U4 outbox drainer Lambda
#                                     (reserved-concurrency=1).
#   - compliance/reader-credentials:  used by the graphql-http Lambda for
#                                     U10 admin Compliance read paths.
#
# Naming follows the slash-delimited "thinkwork/${stage}/..." convention from
# CLAUDE.md (the master `db_credentials` secret above uses the grandfathered
# hyphen form). JSON shape is enriched vs the master's {username, password}:
# {username, password, host, port, dbname} so each consumer is self-contained.
#
# Greenfield bootstrap is operator-driven via scripts/bootstrap-compliance-roles.sh
# which reads passwords from env, populates these secrets via
# `aws secretsmanager put-secret-value`, and runs
# drizzle/0070_compliance_aurora_roles.sql to create the matching Aurora roles.
# Terraform owns the SECRET CONTAINER; the operator owns the SECRET VALUE.
#
# `lifecycle.ignore_changes = [secret_string]` lets operators rotate via the
# bootstrap script (or AWS console) without Terraform clobbering the value
# on the next apply.
################################################################################

resource "aws_secretsmanager_secret" "compliance_writer" {
  count = local.create ? 1 : 0
  name  = "thinkwork/${var.stage}/compliance/writer-credentials"

  tags = {
    Name = "thinkwork-${var.stage}-compliance-writer-credentials"
    Role = "compliance_writer"
  }
}

resource "aws_secretsmanager_secret" "compliance_drainer" {
  count = local.create ? 1 : 0
  name  = "thinkwork/${var.stage}/compliance/drainer-credentials"

  tags = {
    Name = "thinkwork-${var.stage}-compliance-drainer-credentials"
    Role = "compliance_drainer"
  }
}

resource "aws_secretsmanager_secret" "compliance_reader" {
  count = local.create ? 1 : 0
  name  = "thinkwork/${var.stage}/compliance/reader-credentials"

  tags = {
    Name = "thinkwork-${var.stage}-compliance-reader-credentials"
    Role = "compliance_reader"
  }
}
