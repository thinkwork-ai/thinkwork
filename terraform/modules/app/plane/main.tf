################################################################################
# Plane (Optional Managed App) - App Module
#
# Provisions Plane as an AWS-native runtime: public HTTPS ALB, ECS/Fargate
# services, ElastiCache Valkey/Redis, Amazon MQ RabbitMQ, S3 object storage,
# CloudWatch logs, and Secrets Manager references. The composite ThinkWork
# module owns whether this module is instantiated; this module owns runtime
# parking by setting ECS desired counts to zero.
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
  name = "thinkwork-${var.stage}-plane"

  effective_cache_subnet_ids = length(var.cache_subnet_ids) > 0 ? var.cache_subnet_ids : var.subnet_ids
  effective_queue_subnet_ids = length(var.queue_subnet_ids) > 0 ? var.queue_subnet_ids : local.effective_cache_subnet_ids

  redis_scheme = var.cache_transit_encryption_enabled ? "rediss" : "redis"
  redis_url    = "${local.redis_scheme}://${aws_elasticache_replication_group.plane.primary_endpoint_address}:${var.cache_port}"

  managed_secret_specs = {
    db_url = {
      enabled       = var.create_secret_placeholders && var.db_url_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/db-url"
      description   = "Dedicated Plane PostgreSQL DATABASE_URL"
      secret_string = jsonencode({ DATABASE_URL = "PLACEHOLDER_SET_VIA_CI" })
    }
    secret_key = {
      enabled       = var.create_secret_placeholders && var.secret_key_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/secret-key"
      description   = "Plane SECRET_KEY"
      secret_string = jsonencode({ SECRET_KEY = "PLACEHOLDER_SET_VIA_CI" })
    }
    live_server_secret_key = {
      enabled       = var.create_secret_placeholders && var.live_server_secret_key_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/live-server-secret-key"
      description   = "Plane LIVE_SERVER_SECRET_KEY"
      secret_string = jsonencode({ LIVE_SERVER_SECRET_KEY = "PLACEHOLDER_SET_VIA_CI" })
    }
    aes_secret_key = {
      enabled       = var.create_secret_placeholders && var.aes_secret_key_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/aes-secret-key"
      description   = "Plane AES_SECRET_KEY"
      secret_string = jsonencode({ AES_SECRET_KEY = "PLACEHOLDER_SET_VIA_CI" })
    }
    amqp_url = {
      enabled     = var.create_secret_placeholders && var.amqp_url_secret_arn == ""
      name        = "thinkwork/${var.stage}/plane/amqp-url"
      description = "Plane AMQP_URL for the managed RabbitMQ broker"
      secret_string = jsonencode({
        AMQP_URL = "amqps://${var.rabbitmq_admin_username}:${random_password.rabbitmq.result}@${replace(aws_mq_broker.rabbitmq.instances[0].endpoints[0], "amqps://", "")}"
      })
    }
    s3_access_key_id = {
      enabled       = var.create_secret_placeholders && var.s3_access_key_id_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/s3-access-key-id"
      description   = "Plane AWS_ACCESS_KEY_ID for S3 uploads"
      secret_string = jsonencode({ AWS_ACCESS_KEY_ID = "PLACEHOLDER_SET_VIA_CI" })
    }
    s3_secret_access_key = {
      enabled       = var.create_secret_placeholders && var.s3_secret_access_key_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/s3-secret-access-key"
      description   = "Plane AWS_SECRET_ACCESS_KEY for S3 uploads"
      secret_string = jsonencode({ AWS_SECRET_ACCESS_KEY = "PLACEHOLDER_SET_VIA_CI" })
    }
  }

  managed_secrets = {
    for key, spec in local.managed_secret_specs : key => spec if spec.enabled
  }

  effective_db_url_secret_arn = (
    var.db_url_secret_arn != ""
    ? var.db_url_secret_arn
    : try(aws_secretsmanager_secret.plane["db_url"].arn, "")
  )
  effective_secret_key_secret_arn = (
    var.secret_key_secret_arn != ""
    ? var.secret_key_secret_arn
    : try(aws_secretsmanager_secret.plane["secret_key"].arn, "")
  )
  effective_live_server_secret_key_secret_arn = (
    var.live_server_secret_key_secret_arn != ""
    ? var.live_server_secret_key_secret_arn
    : try(aws_secretsmanager_secret.plane["live_server_secret_key"].arn, "")
  )
  effective_aes_secret_key_secret_arn = (
    var.aes_secret_key_secret_arn != ""
    ? var.aes_secret_key_secret_arn
    : try(aws_secretsmanager_secret.plane["aes_secret_key"].arn, "")
  )
  effective_amqp_url_secret_arn = (
    var.amqp_url_secret_arn != ""
    ? var.amqp_url_secret_arn
    : try(aws_secretsmanager_secret.plane["amqp_url"].arn, "")
  )
  effective_s3_access_key_id_secret_arn = (
    var.s3_access_key_id_secret_arn != ""
    ? var.s3_access_key_id_secret_arn
    : try(aws_secretsmanager_secret.plane["s3_access_key_id"].arn, "")
  )
  effective_s3_secret_access_key_secret_arn = (
    var.s3_secret_access_key_secret_arn != ""
    ? var.s3_secret_access_key_secret_arn
    : try(aws_secretsmanager_secret.plane["s3_secret_access_key"].arn, "")
  )

  secret_arns = compact([
    local.effective_db_url_secret_arn,
    local.effective_secret_key_secret_arn,
    local.effective_live_server_secret_key_secret_arn,
    local.effective_aes_secret_key_secret_arn,
    local.effective_amqp_url_secret_arn,
    local.effective_s3_access_key_id_secret_arn,
    local.effective_s3_secret_access_key_secret_arn,
  ])

  base_environment = [
    { name = "WEB_URL", value = var.public_url },
    { name = "CORS_ALLOWED_ORIGINS", value = var.public_url },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "USE_MINIO", value = "0" },
    { name = "AWS_REGION", value = data.aws_region.current.name },
    { name = "AWS_S3_BUCKET_NAME", value = var.s3_bucket_name },
    { name = "AWS_S3_ENDPOINT_URL", value = "" },
    { name = "FILE_SIZE_LIMIT", value = tostring(var.file_size_limit) },
    { name = "ENABLE_SIGNUP", value = tostring(var.enable_signup) },
  ]

  container_secrets = [
    { name = "DATABASE_URL", valueFrom = "${local.effective_db_url_secret_arn}:DATABASE_URL::" },
    { name = "SECRET_KEY", valueFrom = "${local.effective_secret_key_secret_arn}:SECRET_KEY::" },
    { name = "LIVE_SERVER_SECRET_KEY", valueFrom = "${local.effective_live_server_secret_key_secret_arn}:LIVE_SERVER_SECRET_KEY::" },
    { name = "AES_SECRET_KEY", valueFrom = "${local.effective_aes_secret_key_secret_arn}:AES_SECRET_KEY::" },
    { name = "AMQP_URL", valueFrom = "${local.effective_amqp_url_secret_arn}:AMQP_URL::" },
    { name = "AWS_ACCESS_KEY_ID", valueFrom = "${local.effective_s3_access_key_id_secret_arn}:AWS_ACCESS_KEY_ID::" },
    { name = "AWS_SECRET_ACCESS_KEY", valueFrom = "${local.effective_s3_secret_access_key_secret_arn}:AWS_SECRET_ACCESS_KEY::" },
  ]

  service_definitions = {
    web = {
      display_name   = "web"
      command        = var.web_command
      port           = var.web_container_port
      desired_count  = var.web_desired_count
      public_service = true
    }
    api = {
      display_name   = "api"
      command        = var.api_command
      port           = var.api_container_port
      desired_count  = var.api_desired_count
      public_service = false
    }
    worker = {
      display_name   = "worker"
      command        = var.worker_command
      port           = var.worker_container_port
      desired_count  = var.worker_desired_count
      public_service = false
    }
    beat_worker = {
      display_name   = "beat-worker"
      command        = var.beat_worker_command
      port           = var.worker_container_port
      desired_count  = var.beat_worker_desired_count
      public_service = false
    }
    live = {
      display_name   = "live"
      command        = var.live_command
      port           = var.live_container_port
      desired_count  = var.live_desired_count
      public_service = false
    }
  }

  storage_bucket_arn = "arn:aws:s3:::${var.s3_bucket_name}"
}

data "aws_region" "current" {}

resource "random_password" "rabbitmq" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "plane" {
  for_each = local.managed_secrets

  name        = each.value.name
  description = each.value.description

  tags = {
    Name = each.value.name
    Role = "plane"
  }
}

resource "aws_secretsmanager_secret_version" "plane" {
  for_each = local.managed_secrets

  secret_id     = aws_secretsmanager_secret.plane[each.key].id
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
    runtime_enabled                   = var.runtime_enabled
    web_desired_count                 = var.web_desired_count
    api_desired_count                 = var.api_desired_count
    worker_desired_count              = var.worker_desired_count
    beat_worker_desired_count         = var.beat_worker_desired_count
    live_desired_count                = var.live_desired_count
    image_uri                         = var.image_uri
    public_url                        = var.public_url
    certificate_arn                   = var.certificate_arn
    db_url_secret_arn                 = local.effective_db_url_secret_arn
    secret_key_secret_arn             = local.effective_secret_key_secret_arn
    live_server_secret_key_secret_arn = local.effective_live_server_secret_key_secret_arn
    aes_secret_key_secret_arn         = local.effective_aes_secret_key_secret_arn
    amqp_url_secret_arn               = local.effective_amqp_url_secret_arn
    s3_access_key_id_secret_arn       = local.effective_s3_access_key_id_secret_arn
    s3_secret_access_key_secret_arn   = local.effective_s3_secret_access_key_secret_arn
    s3_bucket_name                    = var.s3_bucket_name
    cache_subnet_ids                  = local.effective_cache_subnet_ids
    queue_subnet_ids                  = local.effective_queue_subnet_ids
  }

  lifecycle {
    precondition {
      condition     = !var.runtime_enabled || var.web_desired_count > 0
      error_message = "runtime_enabled requires web_desired_count > 0."
    }

    precondition {
      condition     = !var.runtime_enabled || var.api_desired_count > 0
      error_message = "runtime_enabled requires api_desired_count > 0."
    }

    precondition {
      condition     = !var.runtime_enabled || var.worker_desired_count > 0
      error_message = "runtime_enabled requires worker_desired_count > 0."
    }

    precondition {
      condition     = !var.runtime_enabled || var.live_desired_count > 0
      error_message = "runtime_enabled requires live_desired_count > 0."
    }

    precondition {
      condition     = length(local.effective_cache_subnet_ids) > 0
      error_message = "Plane requires at least one cache subnet."
    }

    precondition {
      condition     = length(local.effective_queue_subnet_ids) > 0
      error_message = "Plane requires at least one RabbitMQ subnet."
    }

    precondition {
      condition     = local.effective_db_url_secret_arn != ""
      error_message = "Plane requires db_url_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_secret_key_secret_arn != ""
      error_message = "Plane requires secret_key_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_live_server_secret_key_secret_arn != ""
      error_message = "Plane requires live_server_secret_key_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_aes_secret_key_secret_arn != ""
      error_message = "Plane requires aes_secret_key_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_amqp_url_secret_arn != ""
      error_message = "Plane requires amqp_url_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_s3_access_key_id_secret_arn != ""
      error_message = "Plane requires s3_access_key_id_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_s3_secret_access_key_secret_arn != ""
      error_message = "Plane requires s3_secret_access_key_secret_arn or create_secret_placeholders = true."
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
  name = "plane-secrets"
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
  name = "plane-s3"
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

resource "aws_security_group" "plane" {
  name_prefix = "${local.name}-"
  description = "Plane ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Public ALB to Plane web"
    from_port       = var.web_container_port
    to_port         = var.web_container_port
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
  description = "Public Plane ALB"
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
  description = "Plane ElastiCache"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Plane tasks to Redis-compatible cache"
    from_port       = var.cache_port
    to_port         = var.cache_port
    protocol        = "tcp"
    security_groups = [aws_security_group.plane.id]
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

resource "aws_security_group" "rabbitmq" {
  name_prefix = "${local.name}-rabbitmq-"
  description = "Plane RabbitMQ"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Plane tasks to RabbitMQ AMQPS"
    from_port       = 5671
    to_port         = 5671
    protocol        = "tcp"
    security_groups = [aws_security_group.plane.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-rabbitmq-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group_rule" "aurora_from_plane" {
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.plane.id
  security_group_id        = var.db_security_group_id
}

################################################################################
# Public ALB
################################################################################

resource "aws_lb" "plane" {
  name               = "tw-${var.stage}-plane"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "web" {
  name        = "tw-${var.stage}-plane-web"
  port        = var.web_container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = var.health_check_path
    port                = tostring(var.web_container_port)
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200-399"
  }

  tags = { Name = "${local.name}-web-tg" }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.plane.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.enable_http_redirect ? 1 : 0

  load_balancer_arn = aws_lb.plane.arn
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
# S3 object storage
################################################################################

resource "aws_s3_bucket" "plane" {
  count = var.create_storage_bucket ? 1 : 0

  bucket = var.s3_bucket_name

  tags = {
    Name = var.s3_bucket_name
    Role = "plane-storage"
  }
}

resource "aws_s3_bucket_public_access_block" "plane" {
  count = var.create_storage_bucket ? 1 : 0

  bucket                  = aws_s3_bucket.plane[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "plane" {
  count = var.create_storage_bucket ? 1 : 0

  bucket = aws_s3_bucket.plane[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

################################################################################
# ElastiCache Valkey/Redis
################################################################################

resource "aws_elasticache_subnet_group" "plane" {
  name       = "tw-${var.stage}-plane"
  subnet_ids = local.effective_cache_subnet_ids
}

resource "aws_elasticache_parameter_group" "plane" {
  name   = "tw-${var.stage}-plane"
  family = var.cache_parameter_group_family

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "plane" {
  replication_group_id = "tw-${var.stage}-plane"
  description          = "Plane Redis-compatible cache"

  engine         = var.cache_engine
  engine_version = var.cache_engine_version
  node_type      = var.cache_node_type
  port           = var.cache_port

  num_cache_clusters         = var.cache_num_cache_clusters
  automatic_failover_enabled = var.cache_num_cache_clusters > 1
  multi_az_enabled           = var.cache_num_cache_clusters > 1

  at_rest_encryption_enabled = true
  transit_encryption_enabled = var.cache_transit_encryption_enabled

  subnet_group_name    = aws_elasticache_subnet_group.plane.name
  security_group_ids   = [aws_security_group.cache.id]
  parameter_group_name = aws_elasticache_parameter_group.plane.name

  tags = { Name = "${local.name}-cache" }
}

################################################################################
# Amazon MQ RabbitMQ
################################################################################

resource "aws_mq_broker" "rabbitmq" {
  broker_name        = "tw-${var.stage}-plane"
  engine_type        = "RabbitMQ"
  engine_version     = var.rabbitmq_engine_version
  host_instance_type = var.rabbitmq_instance_type
  deployment_mode    = "SINGLE_INSTANCE"

  publicly_accessible = false
  security_groups     = [aws_security_group.rabbitmq.id]
  subnet_ids          = [local.effective_queue_subnet_ids[0]]

  auto_minor_version_upgrade = true
  apply_immediately          = true

  user {
    username = var.rabbitmq_admin_username
    password = random_password.rabbitmq.result
  }

  logs {
    general = true
  }

  tags = { Name = "${local.name}-rabbitmq" }
}

################################################################################
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "service" {
  for_each = local.service_definitions

  name              = "/thinkwork/${var.stage}/plane/${each.value.display_name}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/thinkwork/${var.stage}/plane/${each.value.display_name}" }
}

################################################################################
# ECS Task Definitions and Services
################################################################################

resource "aws_ecs_task_definition" "service" {
  for_each = local.service_definitions

  family                   = "${local.name}-${each.value.display_name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "plane-${each.value.display_name}"
      image     = var.image_uri
      essential = true
      command   = each.value.command

      portMappings = [
        {
          containerPort = each.value.port
          hostPort      = each.value.port
          protocol      = "tcp"
        }
      ]

      environment = concat(
        local.base_environment,
        [
          { name = "PORT", value = tostring(each.value.port) },
          { name = "PLANE_SERVICE", value = each.value.display_name },
        ]
      )
      secrets = local.container_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = each.value.display_name
        }
      }
    }
  ])
}

resource "aws_ecs_service" "service" {
  for_each = local.service_definitions

  name            = "${local.name}-${each.value.display_name}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = var.runtime_enabled ? each.value.desired_count : 0
  launch_type     = "FARGATE"

  enable_execute_command            = true
  health_check_grace_period_seconds = each.value.public_service ? var.health_check_grace_period_seconds : null
  wait_for_steady_state             = var.wait_for_steady_state
  force_new_deployment              = true

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.plane.id]
    assign_public_ip = true
  }

  dynamic "load_balancer" {
    for_each = each.value.public_service ? [1] : []

    content {
      target_group_arn = aws_lb_target_group.web.arn
      container_name   = "plane-${each.value.display_name}"
      container_port   = each.value.port
    }
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = "${local.name}-${each.value.display_name}" }
}
