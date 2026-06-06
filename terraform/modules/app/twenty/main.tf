################################################################################
# Twenty CRM (Optional Managed App) - App Module
#
# Provisions Twenty CRM as an AWS-native runtime: public HTTPS ALB, ECS/Fargate
# server and worker, EFS local storage, and ElastiCache for Valkey/Redis OSS.
# The composite ThinkWork module owns whether this module is instantiated; this
# module owns runtime parking by setting ECS desired counts to zero.
################################################################################

locals {
  name = "thinkwork-${var.stage}-twenty"

  effective_cache_subnet_ids   = length(var.cache_subnet_ids) > 0 ? var.cache_subnet_ids : var.subnet_ids
  effective_storage_subnet_ids = length(var.storage_subnet_ids) > 0 ? var.storage_subnet_ids : var.subnet_ids

  storage_path = "/app/packages/twenty-server/.local-storage"
  redis_scheme = var.cache_transit_encryption_enabled ? "rediss" : "redis"
  redis_url    = "${local.redis_scheme}://${aws_elasticache_replication_group.twenty.primary_endpoint_address}:${var.cache_port}"

  managed_secret_specs = {
    db_url = {
      enabled       = var.create_secret_placeholders && var.db_url_secret_arn == ""
      name          = "thinkwork/${var.stage}/twenty/db-url"
      description   = "Dedicated Twenty PostgreSQL connection URL"
      secret_string = jsonencode({ PG_DATABASE_URL = "PLACEHOLDER_SET_VIA_CI" })
    }
    encryption_key = {
      enabled       = var.create_secret_placeholders && var.encryption_key_secret_arn == ""
      name          = "thinkwork/${var.stage}/twenty/encryption-key"
      description   = "Twenty primary encryption key"
      secret_string = jsonencode({ ENCRYPTION_KEY = "PLACEHOLDER_SET_VIA_CI" })
    }
  }

  managed_secrets = {
    for key, spec in local.managed_secret_specs : key => spec if spec.enabled
  }

  effective_db_url_secret_arn = (
    var.db_url_secret_arn != ""
    ? var.db_url_secret_arn
    : try(aws_secretsmanager_secret.twenty["db_url"].arn, "")
  )
  effective_encryption_key_secret_arn = (
    var.encryption_key_secret_arn != ""
    ? var.encryption_key_secret_arn
    : try(aws_secretsmanager_secret.twenty["encryption_key"].arn, "")
  )

  secret_arns = compact([
    local.effective_db_url_secret_arn,
    local.effective_encryption_key_secret_arn,
    var.fallback_encryption_key_secret_arn,
    var.app_secret_arn,
  ])

  storage_mount_subnet_ids_by_index = {
    for index, subnet_id in local.effective_storage_subnet_ids : tostring(index) => subnet_id
  }

  base_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "NODE_PORT", value = tostring(var.container_port) },
    { name = "SERVER_URL", value = var.public_url },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "PG_SSL_ALLOW_SELF_SIGNED", value = "true" },
    { name = "NODE_TLS_REJECT_UNAUTHORIZED", value = "0" },
    { name = "STORAGE_TYPE", value = "local" },
    { name = "STORAGE_LOCAL_PATH", value = local.storage_path },
    { name = "IS_CONFIG_VARIABLES_IN_DB_ENABLED", value = "true" },
    { name = "IS_MULTIWORKSPACE_ENABLED", value = "false" },
  ]

  server_environment = concat(
    local.base_environment,
    [
      { name = "DISABLE_DB_MIGRATIONS", value = "false" },
      { name = "DISABLE_CRON_JOBS_REGISTRATION", value = "false" },
    ]
  )

  worker_environment = concat(
    local.base_environment,
    [
      { name = "DISABLE_DB_MIGRATIONS", value = "true" },
      { name = "DISABLE_CRON_JOBS_REGISTRATION", value = "true" },
    ]
  )

  container_secrets = concat(
    [
      { name = "PG_DATABASE_URL", valueFrom = "${local.effective_db_url_secret_arn}:PG_DATABASE_URL::" },
      { name = "ENCRYPTION_KEY", valueFrom = "${local.effective_encryption_key_secret_arn}:ENCRYPTION_KEY::" },
    ],
    var.fallback_encryption_key_secret_arn != "" ? [{ name = "FALLBACK_ENCRYPTION_KEY", valueFrom = "${var.fallback_encryption_key_secret_arn}:FALLBACK_ENCRYPTION_KEY::" }] : [],
    var.app_secret_arn != "" ? [{ name = "APP_SECRET", valueFrom = "${var.app_secret_arn}:APP_SECRET::" }] : []
  )
}

data "aws_region" "current" {}

resource "aws_secretsmanager_secret" "twenty" {
  for_each = local.managed_secrets

  name        = each.value.name
  description = each.value.description

  tags = {
    Name = each.value.name
    Role = "twenty"
  }
}

resource "aws_secretsmanager_secret_version" "twenty" {
  for_each = local.managed_secrets

  secret_id     = aws_secretsmanager_secret.twenty[each.key].id
  secret_string = each.value.secret_string

  lifecycle {
    ignore_changes = [secret_string]
  }
}

################################################################################
# Plan-time safety guardrails
################################################################################

resource "terraform_data" "configuration_guardrails" {
  input = {
    runtime_enabled           = var.runtime_enabled
    server_desired_count      = var.server_desired_count
    worker_desired_count      = var.worker_desired_count
    image_uri                 = var.image_uri
    public_url                = var.public_url
    certificate_arn           = var.certificate_arn
    db_url_secret_arn         = local.effective_db_url_secret_arn
    encryption_key_secret_arn = local.effective_encryption_key_secret_arn
    cache_engine              = var.cache_engine
    cache_subnet_ids          = local.effective_cache_subnet_ids
  }

  lifecycle {
    precondition {
      condition     = !var.runtime_enabled || var.server_desired_count > 0
      error_message = "runtime_enabled requires server_desired_count > 0."
    }

    precondition {
      condition     = !var.runtime_enabled || var.worker_desired_count > 0
      error_message = "runtime_enabled requires worker_desired_count > 0."
    }

    precondition {
      condition     = local.effective_db_url_secret_arn != ""
      error_message = "Twenty requires db_url_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_encryption_key_secret_arn != ""
      error_message = "Twenty requires encryption_key_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = length(local.effective_cache_subnet_ids) > 0
      error_message = "Twenty requires at least one cache subnet."
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
  count = length(local.secret_arns) > 0 ? 1 : 0

  name = "twenty-secrets"
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

resource "aws_iam_role_policy" "ecs_task_efs" {
  name = "twenty-efs"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
      ]
      Resource = aws_efs_file_system.twenty.arn
      Condition = {
        StringEquals = {
          "elasticfilesystem:AccessPointArn" = aws_efs_access_point.twenty.arn
        }
      }
    }]
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

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "twenty" {
  name_prefix = "${local.name}-"
  description = "Twenty ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Public ALB to Twenty server"
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
  description = "Public Twenty ALB"
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

resource "aws_security_group" "efs" {
  name_prefix = "${local.name}-efs-"
  description = "Twenty EFS storage"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Twenty tasks to EFS"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.twenty.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-efs-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "cache" {
  name_prefix = "${local.name}-cache-"
  description = "Twenty ElastiCache"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Twenty tasks to Redis-compatible cache"
    from_port       = var.cache_port
    to_port         = var.cache_port
    protocol        = "tcp"
    security_groups = [aws_security_group.twenty.id]
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

resource "aws_security_group_rule" "aurora_from_twenty" {
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.twenty.id
  security_group_id        = var.db_security_group_id
}

################################################################################
# Public ALB
################################################################################

resource "aws_lb" "twenty" {
  name               = "tw-${var.stage}-twenty"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "twenty" {
  name        = "tw-${var.stage}-twenty"
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
  load_balancer_arn = aws_lb.twenty.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.twenty.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.enable_http_redirect ? 1 : 0

  load_balancer_arn = aws_lb.twenty.arn
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
# Persistent writable storage
################################################################################

resource "aws_efs_file_system" "twenty" {
  creation_token = local.name
  encrypted      = true

  tags = { Name = "${local.name}-efs" }
}

resource "aws_efs_access_point" "twenty" {
  file_system_id = aws_efs_file_system.twenty.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/local-storage"

    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0775"
    }
  }

  tags = { Name = "${local.name}-efs-ap" }
}

resource "aws_efs_mount_target" "twenty" {
  for_each = local.storage_mount_subnet_ids_by_index

  file_system_id  = aws_efs_file_system.twenty.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

################################################################################
# ElastiCache Valkey/Redis
################################################################################

resource "aws_elasticache_subnet_group" "twenty" {
  name       = "tw-${var.stage}-twenty"
  subnet_ids = local.effective_cache_subnet_ids
}

resource "aws_elasticache_parameter_group" "twenty" {
  name   = "tw-${var.stage}-twenty"
  family = var.cache_parameter_group_family

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "twenty" {
  replication_group_id = "tw-${var.stage}-twenty"
  description          = "Twenty CRM queue/cache"

  engine         = var.cache_engine
  engine_version = var.cache_engine_version
  node_type      = var.cache_node_type
  port           = var.cache_port

  num_cache_clusters         = var.cache_num_cache_clusters
  automatic_failover_enabled = var.cache_num_cache_clusters > 1
  multi_az_enabled           = var.cache_num_cache_clusters > 1

  at_rest_encryption_enabled = true
  transit_encryption_enabled = var.cache_transit_encryption_enabled

  subnet_group_name    = aws_elasticache_subnet_group.twenty.name
  security_group_ids   = [aws_security_group.cache.id]
  parameter_group_name = aws_elasticache_parameter_group.twenty.name

  tags = { Name = "${local.name}-cache" }
}

################################################################################
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "server" {
  name              = "/thinkwork/${var.stage}/twenty/server"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-server-logs" }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/thinkwork/${var.stage}/twenty/worker"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-worker-logs" }
}

################################################################################
# ECS Task Definitions
################################################################################

resource "aws_ecs_task_definition" "server" {
  family                   = "${local.name}-server"
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

  volume {
    name = "twenty-storage"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.twenty.id
      transit_encryption = "ENABLED"

      authorization_config {
        access_point_id = aws_efs_access_point.twenty.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = "twenty-server"
    image     = var.image_uri
    essential = true

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = local.server_environment
    secrets     = local.container_secrets

    mountPoints = [{
      sourceVolume  = "twenty-storage"
      containerPath = local.storage_path
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.server.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "server"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}${var.health_check_path} || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 300
    }
  }])

  depends_on = [
    aws_efs_mount_target.twenty,
    aws_iam_role_policy.ecs_task_efs,
    aws_elasticache_replication_group.twenty,
    terraform_data.configuration_guardrails,
  ]

  tags = { Name = "${local.name}-server" }
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

  volume {
    name = "twenty-storage"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.twenty.id
      transit_encryption = "ENABLED"

      authorization_config {
        access_point_id = aws_efs_access_point.twenty.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = "twenty-worker"
    image     = var.image_uri
    essential = true
    command   = ["yarn", "worker:prod"]

    environment = local.worker_environment
    secrets     = local.container_secrets

    mountPoints = [{
      sourceVolume  = "twenty-storage"
      containerPath = local.storage_path
      readOnly      = false
    }]

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
    aws_efs_mount_target.twenty,
    aws_iam_role_policy.ecs_task_efs,
    aws_elasticache_replication_group.twenty,
    terraform_data.configuration_guardrails,
  ]

  tags = { Name = "${local.name}-worker" }
}

################################################################################
# ECS Services
################################################################################

resource "aws_ecs_service" "server" {
  name            = "${local.name}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.runtime_enabled ? var.server_desired_count : 0
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = var.runtime_enabled ? 100 : 0
  deployment_maximum_percent         = var.runtime_enabled ? 200 : 100
  health_check_grace_period_seconds  = var.health_check_grace_period_seconds
  wait_for_steady_state              = var.wait_for_steady_state

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.twenty.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.twenty.arn
    container_name   = "twenty-server"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.https, terraform_data.configuration_guardrails]

  tags = { Name = "${local.name}-server" }
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
    security_groups  = [aws_security_group.twenty.id]
    assign_public_ip = true
  }

  depends_on = [aws_ecs_service.server, terraform_data.configuration_guardrails]

  tags = { Name = "${local.name}-worker" }
}
