################################################################################
# n8n (Optional Managed App) - App Module
#
# Provisions n8n as an AWS-native runtime: public HTTPS ALB, ECS/Fargate main
# and worker services, managed Valkey/Redis queue, retained S3 artifact bucket,
# and secret indirection for database/encryption/operator/service credentials.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

locals {
  name = "thinkwork-${var.stage}-n8n"

  effective_cache_subnet_ids = (
    length(var.cache_subnet_ids) > 0 ? var.cache_subnet_ids : var.subnet_ids
  )

  public_host    = trimprefix(var.public_url, "https://")
  image_digest   = regex("sha256:[0-9a-f]{64}$", var.image_uri)
  storage_prefix = trim(var.storage_prefix, "/") != "" ? trim(var.storage_prefix, "/") : "managed-apps/n8n"

  redis_url = "${var.cache_transit_encryption_enabled ? "rediss" : "redis"}://${aws_elasticache_replication_group.n8n.primary_endpoint_address}:${var.cache_port}"
  use_s3_storage = (
    var.execution_data_storage_mode == "s3" ||
    var.binary_data_mode == "s3"
  )
  custom_package_allow_list = [
    for spec in var.custom_package_specs : regex("^(@[^/]+/[^@]+|[^@]+)@", spec)[0]
  ]

  storage_bucket_arn = "arn:aws:s3:::${var.storage_bucket_name}"

  managed_secret_specs = {
    database_url = {
      enabled     = var.create_secret_placeholders && var.database_url_secret_arn == ""
      name        = "thinkwork/${var.stage}/n8n/database-url"
      description = "Dedicated n8n PostgreSQL connection secret"
      secret_string = jsonencode({
        DATABASE_URL           = "postgresql://${var.database_username}:${urlencode(random_password.database_password.result)}@${var.database_host}:${var.database_port}/${var.database_name}?sslmode=require"
        DB_POSTGRESDB_PASSWORD = random_password.database_password.result
      })
    }
    encryption_key = {
      enabled       = var.create_secret_placeholders && var.encryption_key_secret_arn == ""
      name          = "thinkwork/${var.stage}/n8n/encryption-key"
      description   = "n8n N8N_ENCRYPTION_KEY"
      secret_string = jsonencode({ N8N_ENCRYPTION_KEY = random_password.encryption_key.result })
    }
    operator = {
      enabled     = var.create_secret_placeholders && var.operator_secret_arn == ""
      name        = "thinkwork/${var.stage}/n8n/operator"
      description = "Shared native n8n operator credential"
      secret_string = jsonencode({
        N8N_OPERATOR_EMAIL    = var.operator_email
        N8N_OPERATOR_PASSWORD = random_password.operator_password.result
      })
    }
    service_credential = {
      enabled     = var.create_secret_placeholders && var.service_credential_secret_arn == ""
      name        = "thinkwork/${var.stage}/n8n/service-credential"
      description = "Tenant service credential used by the native n8n MCP integration"
      secret_string = jsonencode({
        N8N_MCP_SERVICE_CREDENTIAL = random_password.service_credential.result
      })
    }
  }

  managed_secrets = {
    for key, spec in local.managed_secret_specs : key => spec if spec.enabled
  }

  effective_database_url_secret_arn = (
    var.database_url_secret_arn != ""
    ? var.database_url_secret_arn
    : try(aws_secretsmanager_secret.n8n["database_url"].arn, "")
  )
  effective_encryption_key_secret_arn = (
    var.encryption_key_secret_arn != ""
    ? var.encryption_key_secret_arn
    : try(aws_secretsmanager_secret.n8n["encryption_key"].arn, "")
  )
  effective_operator_secret_arn = (
    var.operator_secret_arn != ""
    ? var.operator_secret_arn
    : try(aws_secretsmanager_secret.n8n["operator"].arn, "")
  )
  effective_service_credential_secret_arn = (
    var.service_credential_secret_arn != ""
    ? var.service_credential_secret_arn
    : try(aws_secretsmanager_secret.n8n["service_credential"].arn, "")
  )

  secret_arns = compact([
    local.effective_database_url_secret_arn,
    local.effective_encryption_key_secret_arn,
    local.effective_operator_secret_arn,
    local.effective_service_credential_secret_arn,
  ])

  base_environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "N8N_HOST", value = local.public_host },
      { name = "N8N_PORT", value = tostring(var.container_port) },
      { name = "N8N_PROTOCOL", value = "https" },
      { name = "N8N_EDITOR_BASE_URL", value = var.public_url },
      { name = "WEBHOOK_URL", value = var.public_url },
      { name = "N8N_SECURE_COOKIE", value = "true" },
      { name = "N8N_DIAGNOSTICS_ENABLED", value = "false" },
      { name = "N8N_VERSION_NOTIFICATIONS_ENABLED", value = "false" },
      { name = "N8N_HIRING_BANNER_ENABLED", value = "false" },
      { name = "N8N_PERSONALIZATION_ENABLED", value = "false" },
      { name = "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS", value = "true" },
      { name = "N8N_USER_MANAGEMENT_DISABLED", value = "false" },
      { name = "DB_TYPE", value = "postgresdb" },
      { name = "DB_POSTGRESDB_HOST", value = var.database_host },
      { name = "DB_POSTGRESDB_PORT", value = tostring(var.database_port) },
      { name = "DB_POSTGRESDB_DATABASE", value = var.database_name },
      { name = "DB_POSTGRESDB_USER", value = var.database_username },
      { name = "DB_POSTGRESDB_SSL_ENABLED", value = "true" },
      { name = "DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED", value = "false" },
      { name = "EXECUTIONS_MODE", value = var.queue_mode ? "queue" : "regular" },
      { name = "QUEUE_BULL_REDIS_HOST", value = aws_elasticache_replication_group.n8n.primary_endpoint_address },
      { name = "QUEUE_BULL_REDIS_PORT", value = tostring(var.cache_port) },
      { name = "QUEUE_BULL_REDIS_TLS", value = tostring(var.cache_transit_encryption_enabled) },
      { name = "QUEUE_BULL_REDIS_DB", value = "0" },
      { name = "QUEUE_HEALTH_CHECK_ACTIVE", value = "true" },
      { name = "N8N_DEFAULT_BINARY_DATA_MODE", value = var.binary_data_mode },
      { name = "N8N_EXECUTION_DATA_STORAGE_MODE", value = var.execution_data_storage_mode },
      { name = "N8N_STORAGE_BUCKET_NAME", value = var.storage_bucket_name },
      { name = "N8N_STORAGE_PREFIX", value = local.storage_prefix },
      { name = "N8N_PACKAGE_CONFIG_DIGEST", value = var.package_config_digest },
      { name = "N8N_CUSTOM_PACKAGE_SPECS", value = jsonencode(var.custom_package_specs) },
      { name = "NODE_FUNCTION_ALLOW_EXTERNAL", value = join(",", local.custom_package_allow_list) },
      { name = "N8N_RUNNERS_ENABLED", value = tostring(var.task_runners_enabled) },
      { name = "N8N_QUEUE_MODE_REQUIRED", value = tostring(var.queue_mode) },
    ],
    local.use_s3_storage ? [
      { name = "N8N_EXTERNAL_STORAGE_S3_BUCKET_NAME", value = var.storage_bucket_name },
      { name = "N8N_EXTERNAL_STORAGE_S3_BUCKET_REGION", value = data.aws_region.current.name },
      { name = "N8N_EXTERNAL_STORAGE_S3_AUTH_AUTO_DETECT", value = "true" },
    ] : [],
  )

  container_secrets = [
    { name = "DATABASE_URL", valueFrom = "${local.effective_database_url_secret_arn}:DATABASE_URL::" },
    { name = "DB_POSTGRESDB_PASSWORD", valueFrom = "${local.effective_database_url_secret_arn}:DB_POSTGRESDB_PASSWORD::" },
    { name = "N8N_ENCRYPTION_KEY", valueFrom = "${local.effective_encryption_key_secret_arn}:N8N_ENCRYPTION_KEY::" },
    { name = "N8N_OPERATOR_EMAIL", valueFrom = "${local.effective_operator_secret_arn}:N8N_OPERATOR_EMAIL::" },
    { name = "N8N_OPERATOR_PASSWORD", valueFrom = "${local.effective_operator_secret_arn}:N8N_OPERATOR_PASSWORD::" },
    { name = "N8N_MCP_SERVICE_CREDENTIAL", valueFrom = "${local.effective_service_credential_secret_arn}:N8N_MCP_SERVICE_CREDENTIAL::" },
  ]
}

data "aws_region" "current" {}

resource "random_password" "database_password" {
  length  = 32
  special = false
}

resource "random_password" "encryption_key" {
  length  = 32
  special = false
}

resource "random_password" "operator_password" {
  length  = 32
  special = true
}

resource "random_password" "service_credential" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "n8n" {
  for_each = local.managed_secrets

  # Placeholder secrets must survive repeated app-plugin install, teardown, and
  # reinstall verification loops. Fixed names collide with Secrets Manager
  # secrets that are still pending deletion after a failed or recent destroy.
  name_prefix             = "${each.value.name}-"
  description             = each.value.description
  recovery_window_in_days = 0

  tags = {
    Name = each.value.name
    Role = "n8n"
  }
}

resource "aws_secretsmanager_secret_version" "n8n" {
  for_each = local.managed_secrets

  secret_id     = aws_secretsmanager_secret.n8n[each.key].id
  secret_string = each.value.secret_string

  lifecycle {
    ignore_changes = [secret_string]
  }
}

################################################################################
# Plan-time safety guardrails
################################################################################

resource "terraform_data" "database_lifecycle" {
  input = {
    database_name             = var.database_name
    database_username         = var.database_username
    database_admin_secret_arn = var.database_admin_secret_arn
    database_url_secret_arn   = local.effective_database_url_secret_arn
    database_host             = var.database_host
    database_port             = tostring(var.database_port)
    sync_script_path          = abspath("${path.module}/scripts/sync-database.py")
    sync_script_sha256        = filesha256("${path.module}/scripts/sync-database.py")
    database_url_version_id   = try(aws_secretsmanager_secret_version.n8n["database_url"].version_id, "")
  }

  triggers_replace = {
    database_name             = var.database_name
    database_username         = var.database_username
    database_admin_secret_arn = var.database_admin_secret_arn
    database_url_secret_arn   = local.effective_database_url_secret_arn
    database_host             = var.database_host
    database_port             = tostring(var.database_port)
    sync_script_sha256        = filesha256("${path.module}/scripts/sync-database.py")
    database_url_version_id   = try(aws_secretsmanager_secret_version.n8n["database_url"].version_id, "")
  }

  provisioner "local-exec" {
    command = "python3 ${path.module}/scripts/sync-database.py up"

    environment = {
      N8N_DATABASE_NAME             = var.database_name
      N8N_DATABASE_USERNAME         = var.database_username
      N8N_DATABASE_ADMIN_SECRET_ARN = var.database_admin_secret_arn
      N8N_DATABASE_URL_SECRET_ARN   = local.effective_database_url_secret_arn
      N8N_DATABASE_HOST             = var.database_host
      N8N_DATABASE_PORT             = tostring(var.database_port)
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      if [ -n "$N8N_DATABASE_SYNC_SCRIPT_PATH" ] && [ -f "$N8N_DATABASE_SYNC_SCRIPT_PATH" ]; then
        python3 "$N8N_DATABASE_SYNC_SCRIPT_PATH" destroy
      else
        echo "Skipping n8n database lifecycle destroy for legacy state without sync metadata or sync script."
      fi
    EOT

    environment = {
      N8N_DATABASE_NAME             = try(self.input.database_name, "")
      N8N_DATABASE_USERNAME         = try(self.input.database_username, "")
      N8N_DATABASE_ADMIN_SECRET_ARN = try(self.input.database_admin_secret_arn, "")
      N8N_DATABASE_URL_SECRET_ARN   = try(self.input.database_url_secret_arn, "")
      N8N_DATABASE_HOST             = try(self.input.database_host, "")
      N8N_DATABASE_PORT             = try(self.input.database_port, "")
      N8N_DATABASE_SYNC_SCRIPT_PATH = try(self.input.sync_script_path, "")
    }
  }

  lifecycle {
    precondition {
      condition     = var.database_admin_secret_arn != ""
      error_message = "n8n requires database_admin_secret_arn so the managed-app setup step can create/drop the dedicated database and role."
    }

    precondition {
      condition     = local.effective_database_url_secret_arn != ""
      error_message = "n8n requires database_url_secret_arn or create_secret_placeholders = true."
    }
  }

  depends_on = [
    aws_secretsmanager_secret_version.n8n,
  ]
}

resource "terraform_data" "configuration_guardrails" {
  input = {
    runtime_enabled               = var.runtime_enabled
    main_desired_count            = var.main_desired_count
    worker_desired_count          = var.worker_desired_count
    image_uri                     = var.image_uri
    public_url                    = var.public_url
    certificate_arn               = var.certificate_arn
    database_host                 = var.database_host
    database_name                 = var.database_name
    database_username             = var.database_username
    database_url_secret_arn       = local.effective_database_url_secret_arn
    encryption_key_secret_arn     = local.effective_encryption_key_secret_arn
    operator_secret_arn           = local.effective_operator_secret_arn
    service_credential_secret_arn = local.effective_service_credential_secret_arn
    storage_bucket_name           = var.storage_bucket_name
    storage_prefix                = local.storage_prefix
    queue_mode                    = var.queue_mode
    cache_engine                  = var.cache_engine
    cache_subnet_ids              = local.effective_cache_subnet_ids
  }

  lifecycle {
    precondition {
      condition     = var.queue_mode
      error_message = "n8n managed app requires queue_mode = true."
    }

    precondition {
      condition     = !var.runtime_enabled || var.main_desired_count > 0
      error_message = "runtime_enabled requires main_desired_count > 0."
    }

    precondition {
      condition     = !var.runtime_enabled || var.worker_desired_count > 0
      error_message = "runtime_enabled requires worker_desired_count > 0."
    }

    precondition {
      condition     = var.database_host != ""
      error_message = "n8n requires database_host for the existing ThinkWork PostgreSQL instance."
    }

    precondition {
      condition     = local.effective_encryption_key_secret_arn != ""
      error_message = "n8n requires encryption_key_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_operator_secret_arn != ""
      error_message = "n8n requires operator_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_service_credential_secret_arn != ""
      error_message = "n8n requires service_credential_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = var.storage_bucket_name != ""
      error_message = "n8n requires storage_bucket_name."
    }

    precondition {
      condition     = local.storage_prefix != ""
      error_message = "n8n requires a non-empty storage_prefix."
    }

    precondition {
      condition     = length(local.effective_cache_subnet_ids) > 0
      error_message = "n8n requires at least one cache subnet for managed Valkey/Redis."
    }
  }
}

################################################################################
# ECS Cluster
################################################################################

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.name}-cluster" }
}

################################################################################
# IAM
################################################################################

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name}-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "n8n-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.secret_arns
      }],
      length(var.kms_key_arns) > 0 ? [{
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.kms_key_arns
      }] : []
    )
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "n8n-s3"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:AbortMultipartUpload",
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject",
      ]
      Resource = [
        local.storage_bucket_arn,
        "${local.storage_bucket_arn}/*",
      ]
    }]
  })
}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "n8n" {
  name_prefix = "${local.name}-"
  description = "n8n ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Public ALB to n8n main service"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  description = "Public n8n ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "Public HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_public_cidr_blocks
  }

  dynamic "ingress" {
    for_each = var.enable_http_redirect ? [1] : []

    content {
      description = "Public HTTP redirect"
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      cidr_blocks = var.allowed_public_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-alb-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "cache" {
  name_prefix = "${local.name}-cache-"
  description = "n8n managed Valkey/Redis queue"
  vpc_id      = var.vpc_id

  ingress {
    description     = "n8n tasks to managed Valkey/Redis"
    from_port       = var.cache_port
    to_port         = var.cache_port
    protocol        = "tcp"
    security_groups = [aws_security_group.n8n.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-cache-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group_rule" "aurora_from_n8n" {
  type                     = "ingress"
  from_port                = var.database_port
  to_port                  = var.database_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.n8n.id
  security_group_id        = var.db_security_group_id
}

################################################################################
# Public ALB
################################################################################

resource "aws_lb" "n8n" {
  name               = "tw-${var.stage}-n8n"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "n8n" {
  name        = "tw-${var.stage}-n8n"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = var.health_check_path
    port                = tostring(var.container_port)
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200-399"
  }

  tags = { Name = "${local.name}-tg" }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.n8n.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.n8n.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.enable_http_redirect ? 1 : 0

  load_balancer_arn = aws_lb.n8n.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

################################################################################
# S3 artifact storage
################################################################################

resource "aws_s3_bucket" "n8n" {
  count = var.create_storage_bucket ? 1 : 0

  bucket = var.storage_bucket_name

  tags = {
    Name = var.storage_bucket_name
    Role = "n8n-storage"
  }
}

resource "aws_s3_bucket_public_access_block" "n8n" {
  count = var.create_storage_bucket ? 1 : 0

  bucket                  = aws_s3_bucket.n8n[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "n8n" {
  count = var.create_storage_bucket ? 1 : 0

  bucket = aws_s3_bucket.n8n[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "n8n" {
  count = var.create_storage_bucket ? 1 : 0

  bucket = aws_s3_bucket.n8n[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

################################################################################
# ElastiCache Valkey/Redis
################################################################################

resource "aws_elasticache_subnet_group" "n8n" {
  name       = "tw-${var.stage}-n8n"
  subnet_ids = local.effective_cache_subnet_ids
}

resource "aws_elasticache_parameter_group" "n8n" {
  name   = "tw-${var.stage}-n8n"
  family = var.cache_parameter_group_family

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "n8n" {
  replication_group_id = "tw-${var.stage}-n8n"
  description          = "n8n queue"

  engine         = var.cache_engine
  engine_version = var.cache_engine_version
  node_type      = var.cache_node_type
  port           = var.cache_port

  num_cache_clusters         = var.cache_num_cache_clusters
  automatic_failover_enabled = var.cache_num_cache_clusters > 1
  multi_az_enabled           = var.cache_num_cache_clusters > 1

  at_rest_encryption_enabled = true
  transit_encryption_enabled = var.cache_transit_encryption_enabled

  subnet_group_name    = aws_elasticache_subnet_group.n8n.name
  security_group_ids   = [aws_security_group.cache.id]
  parameter_group_name = aws_elasticache_parameter_group.n8n.name

  tags = { Name = "${local.name}-cache" }
}

################################################################################
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "main" {
  name              = "/thinkwork/${var.stage}/n8n/main"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-main-logs" }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/thinkwork/${var.stage}/n8n/worker"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-worker-logs" }
}

################################################################################
# ECS Task Definitions
################################################################################

resource "aws_ecs_task_definition" "main" {
  family                   = "${local.name}-main"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name      = "n8n-main"
    image     = var.image_uri
    essential = true

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = local.base_environment
    secrets     = local.container_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.main.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "main"
      }
    }

    healthCheck = {
      command = [
        "CMD-SHELL",
        "node -e \"fetch('http://localhost:${var.container_port}${var.health_check_path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
      ]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 300
    }
  }])

  depends_on = [
    aws_elasticache_replication_group.n8n,
    aws_iam_role_policy.ecs_execution_secrets,
    aws_iam_role_policy.ecs_task_s3,
    terraform_data.database_lifecycle,
    terraform_data.configuration_guardrails,
  ]

  tags = { Name = "${local.name}-main" }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name      = "n8n-worker"
    image     = var.image_uri
    essential = true
    command   = ["worker", "--concurrency=${var.worker_concurrency}"]

    environment = local.base_environment
    secrets     = local.container_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.worker.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])

  depends_on = [
    aws_elasticache_replication_group.n8n,
    aws_iam_role_policy.ecs_execution_secrets,
    aws_iam_role_policy.ecs_task_s3,
    terraform_data.database_lifecycle,
    terraform_data.configuration_guardrails,
  ]

  tags = { Name = "${local.name}-worker" }
}

################################################################################
# ECS Services
################################################################################

resource "aws_ecs_service" "main" {
  name            = "${local.name}-main"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = var.runtime_enabled ? var.main_desired_count : 0
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = var.runtime_enabled ? 100 : 0
  deployment_maximum_percent         = var.runtime_enabled ? 200 : 100
  health_check_grace_period_seconds  = var.health_check_grace_period_seconds
  wait_for_steady_state              = var.wait_for_steady_state

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.n8n.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.n8n.arn
    container_name   = "n8n-main"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.https, terraform_data.configuration_guardrails]

  tags = { Name = "${local.name}-main" }
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.runtime_enabled ? var.worker_desired_count : 0
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = var.runtime_enabled ? 100 : 0
  deployment_maximum_percent         = var.runtime_enabled ? 200 : 100
  wait_for_steady_state              = var.wait_for_steady_state

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.n8n.id]
    assign_public_ip = true
  }

  depends_on = [aws_ecs_service.main, terraform_data.configuration_guardrails]

  tags = { Name = "${local.name}-worker" }
}
