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
  create      = var.create_database
  use_aurora  = local.create && var.database_engine == "aurora-serverless"
  use_rds     = local.create && var.database_engine == "rds-postgres"

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
