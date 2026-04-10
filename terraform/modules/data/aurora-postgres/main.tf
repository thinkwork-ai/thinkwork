################################################################################
# Aurora PostgreSQL — Data Module
#
# Creates an Aurora Serverless v2 PostgreSQL cluster with pgvector support,
# or accepts an existing cluster via BYO variables.
################################################################################

locals {
  create = var.create_database

  cluster_identifier = "thinkwork-${var.stage}-db"
  master_username    = "thinkwork_admin"

  db_cluster_arn        = local.create ? aws_rds_cluster.main[0].arn : var.existing_db_cluster_arn
  graphql_db_secret_arn = local.create ? aws_secretsmanager_secret.graphql_db_credentials[0].arn : var.existing_db_secret_arn
  cluster_endpoint      = local.create ? aws_rds_cluster.main[0].endpoint : var.existing_db_endpoint
  db_security_group_id  = local.create ? aws_security_group.db[0].id : var.existing_db_security_group_id
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "db" {
  count       = local.create ? 1 : 0
  description = "Security group for Thinkwork Aurora PostgreSQL cluster"
  vpc_id      = var.vpc_id

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
# DB Subnet Group
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
# Aurora Serverless v2 Cluster
################################################################################

resource "aws_rds_cluster" "main" {
  count = local.create ? 1 : 0

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
  deletion_protection  = var.deletion_protection
  storage_encrypted    = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  tags = {
    Name = "thinkwork-${var.stage}-db"
  }
}

################################################################################
# Aurora Serverless v2 Instance
################################################################################

resource "aws_rds_cluster_instance" "main" {
  count = local.create ? 1 : 0

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
# Secrets Manager — DB Credentials
################################################################################

resource "aws_secretsmanager_secret" "graphql_db_credentials" {
  count = local.create ? 1 : 0
  name  = "thinkwork-${var.stage}-db-credentials"

  tags = {
    Name = "thinkwork-${var.stage}-db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "graphql_db_credentials" {
  count     = local.create ? 1 : 0
  secret_id = aws_secretsmanager_secret.graphql_db_credentials[0].id

  secret_string = jsonencode({
    username = local.master_username
    password = var.db_password
  })
}
