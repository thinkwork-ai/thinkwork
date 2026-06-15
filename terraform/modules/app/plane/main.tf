################################################################################
# Plane (Optional Managed App) - App Module
#
# Provisions Plane as a compact AWS-native runtime: one ECS/Fargate service
# with the Plane all-in-one app container and the Plane MCP sidecar. Do not add
# separately managed Redis/Valkey, RabbitMQ/Amazon MQ, or per-service Plane ECS
# services to this module.
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

  effective_app_image_uri = var.image_uri

  managed_s3_access_key_enabled = (
    var.create_secret_placeholders &&
    var.s3_access_key_id_secret_arn == "" &&
    var.s3_secret_access_key_secret_arn == ""
  )

  managed_secret_specs = {
    db_url = {
      enabled       = var.create_secret_placeholders && var.db_url_secret_arn == ""
      name          = "thinkwork/${var.stage}/plane/db-url"
      description   = "Dedicated Plane PostgreSQL DATABASE_URL"
      secret_string = jsonencode({ DATABASE_URL = "PLACEHOLDER_SET_VIA_CI" })
    }
    secret_key = {
      enabled       = var.create_secret_placeholders && var.secret_key_secret_arn == ""
      name_prefix   = "thinkwork/${var.stage}/plane/secret-key-"
      description   = "Plane SECRET_KEY"
      secret_string = jsonencode({ SECRET_KEY = random_password.secret_key.result })
    }
    live_server_secret_key = {
      enabled       = var.create_secret_placeholders && var.live_server_secret_key_secret_arn == ""
      name_prefix   = "thinkwork/${var.stage}/plane/live-server-secret-key-"
      description   = "Plane LIVE_SERVER_SECRET_KEY"
      secret_string = jsonencode({ LIVE_SERVER_SECRET_KEY = random_password.live_server_secret_key.result })
    }
    aes_secret_key = {
      enabled       = var.create_secret_placeholders && var.aes_secret_key_secret_arn == ""
      name_prefix   = "thinkwork/${var.stage}/plane/aes-secret-key-"
      description   = "Plane AES_SECRET_KEY"
      secret_string = jsonencode({ AES_SECRET_KEY = random_password.aes_secret_key.result })
    }
    s3_access_key_id = {
      enabled       = local.managed_s3_access_key_enabled
      name          = "thinkwork/${var.stage}/plane/s3-access-key-id"
      description   = "Plane AWS_ACCESS_KEY_ID scoped to the Plane uploads bucket"
      secret_string = jsonencode({ AWS_ACCESS_KEY_ID = aws_iam_access_key.plane_s3[0].id })
    }
    s3_secret_access_key = {
      enabled       = local.managed_s3_access_key_enabled
      name          = "thinkwork/${var.stage}/plane/s3-secret-access-key"
      description   = "Plane AWS_SECRET_ACCESS_KEY scoped to the Plane uploads bucket"
      secret_string = jsonencode({ AWS_SECRET_ACCESS_KEY = aws_iam_access_key.plane_s3[0].secret })
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
    local.effective_s3_access_key_id_secret_arn,
    local.effective_s3_secret_access_key_secret_arn,
  ])

  base_environment = [
    { name = "DOMAIN_NAME", value = trimprefix(var.public_url, "https://") },
    { name = "SITE_ADDRESS", value = ":${var.web_container_port}" },
    { name = "LISTEN_HTTP_PORT", value = tostring(var.web_container_port) },
    { name = "APP_PROTOCOL", value = "http" },
    { name = "WEB_URL", value = var.public_url },
    { name = "INTEGRATION_CALLBACK_BASE_URL", value = var.public_url },
    { name = "CORS_ALLOWED_ORIGINS", value = var.public_url },
    { name = "USE_MINIO", value = "0" },
    { name = "AWS_REGION", value = data.aws_region.current.name },
    { name = "AWS_S3_BUCKET_NAME", value = var.s3_bucket_name },
    { name = "FILE_SIZE_LIMIT", value = tostring(var.file_size_limit) },
    { name = "ENABLE_SIGNUP", value = tostring(var.enable_signup) },
  ]

  mcp_environment = [
    { name = "PORT", value = tostring(var.mcp_container_port) },
    { name = "PLANE_BASE_URL", value = var.public_url },
    { name = "PLANE_INTERNAL_BASE_URL", value = var.public_url },
    { name = "PLANE_OAUTH_PROVIDER_BASE_URL", value = var.public_url },
    { name = "PLANE_OAUTH_PROVIDER_CLIENT_ID", value = "thinkwork-plane-mcp" },
  ]

  container_secrets = [
    { name = "DATABASE_URL", valueFrom = "${local.effective_db_url_secret_arn}:DATABASE_URL::" },
    { name = "SECRET_KEY", valueFrom = "${local.effective_secret_key_secret_arn}:SECRET_KEY::" },
    { name = "LIVE_SERVER_SECRET_KEY", valueFrom = "${local.effective_live_server_secret_key_secret_arn}:LIVE_SERVER_SECRET_KEY::" },
    { name = "AES_SECRET_KEY", valueFrom = "${local.effective_aes_secret_key_secret_arn}:AES_SECRET_KEY::" },
  ]

  optional_container_secrets = concat(
    local.effective_s3_access_key_id_secret_arn != "" ? [
      { name = "AWS_ACCESS_KEY_ID", valueFrom = "${local.effective_s3_access_key_id_secret_arn}:AWS_ACCESS_KEY_ID::" },
    ] : [],
    local.effective_s3_secret_access_key_secret_arn != "" ? [
      { name = "AWS_SECRET_ACCESS_KEY", valueFrom = "${local.effective_s3_secret_access_key_secret_arn}:AWS_SECRET_ACCESS_KEY::" },
    ] : [],
  )

  mcp_container_secrets = [
    { name = "PLANE_OAUTH_PROVIDER_CLIENT_SECRET", valueFrom = "${local.effective_secret_key_secret_arn}:SECRET_KEY::" },
  ]

  container_specs = {
    app = {
      display_name   = "app"
      image          = local.effective_app_image_uri
      command        = var.web_command
      port           = var.web_container_port
      public_service = true
      health_path    = "/"
      environment    = local.base_environment
      secrets        = concat(local.container_secrets, local.optional_container_secrets)
    }
    mcp = {
      display_name   = "mcp"
      image          = var.mcp_image_uri
      command        = var.mcp_command
      port           = var.mcp_container_port
      public_service = true
      health_path    = "/http/api-key/mcp"
      environment    = local.mcp_environment
      secrets        = local.mcp_container_secrets
    }
  }

  public_services = {
    app = {
      display_name = "app"
      port         = var.web_container_port
      health_path  = "/"
    }
    mcp = {
      display_name = "mcp"
      port         = var.mcp_container_port
      health_path  = "/http/api-key/mcp"
    }
  }

  listener_rules = {
    mcp = {
      priority      = 10
      service_key   = "mcp"
      path_patterns = ["/http/*", "/.well-known/*"]
    }
  }

  public_container_ports = toset([
    for service in values(local.public_services) : tostring(service.port)
  ])

  storage_bucket_arn = "arn:aws:s3:::${var.s3_bucket_name}"
}

data "aws_region" "current" {}

resource "random_password" "secret_key" {
  length  = 50
  special = false
}

resource "random_password" "live_server_secret_key" {
  length  = 50
  special = false
}

resource "random_password" "aes_secret_key" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "plane" {
  for_each = local.managed_secrets

  name        = try(each.value.name, null)
  name_prefix = try(each.value.name_prefix, null)
  description = each.value.description

  tags = {
    Name = trimsuffix(
      coalesce(try(each.value.name, null), try(each.value.name_prefix, null)),
      "-",
    )
    Role = "plane"
  }
}

resource "aws_secretsmanager_secret_version" "plane" {
  for_each = local.managed_secrets

  secret_id     = aws_secretsmanager_secret.plane[each.key].id
  secret_string = each.value.secret_string
}

################################################################################
# Plan-time safety guardrails
################################################################################

resource "terraform_data" "configuration_guardrails" {
  input = {
    runtime_enabled                   = var.runtime_enabled
    web_desired_count                 = var.web_desired_count
    image_uri                         = var.image_uri
    app_image_uri                     = local.effective_app_image_uri
    mcp_image_uri                     = var.mcp_image_uri
    public_url                        = var.public_url
    certificate_arn                   = var.certificate_arn
    db_url_secret_arn                 = local.effective_db_url_secret_arn
    secret_key_secret_arn             = local.effective_secret_key_secret_arn
    live_server_secret_key_secret_arn = local.effective_live_server_secret_key_secret_arn
    aes_secret_key_secret_arn         = local.effective_aes_secret_key_secret_arn
    s3_access_key_id_secret_arn       = local.effective_s3_access_key_id_secret_arn
    s3_secret_access_key_secret_arn   = local.effective_s3_secret_access_key_secret_arn
    s3_bucket_name                    = var.s3_bucket_name
  }

  lifecycle {
    precondition {
      condition     = !var.runtime_enabled || var.web_desired_count > 0
      error_message = "runtime_enabled requires web_desired_count > 0."
    }

    precondition {
      condition = (
        local.effective_app_image_uri != "" &&
        var.mcp_image_uri != ""
      )
      error_message = "Plane requires AIO app and MCP image URIs pinned to immutable digests."
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
      condition     = (var.s3_access_key_id_secret_arn == "") == (var.s3_secret_access_key_secret_arn == "")
      error_message = "Plane S3 access key secret ARNs must be provided together, or both omitted for Terraform-managed bucket-scoped credentials."
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

resource "aws_iam_user" "plane_s3" {
  count = local.managed_s3_access_key_enabled ? 1 : 0

  name = "${local.name}-s3"

  tags = {
    Name = "${local.name}-s3"
    Role = "plane-storage"
  }
}

resource "aws_iam_user_policy" "plane_s3" {
  count = local.managed_s3_access_key_enabled ? 1 : 0

  name = "plane-s3"
  user = aws_iam_user.plane_s3[0].name

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

resource "aws_iam_access_key" "plane_s3" {
  count = local.managed_s3_access_key_enabled ? 1 : 0

  user = aws_iam_user.plane_s3[0].name
}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "plane" {
  name_prefix = "${local.name}-"
  description = "Plane ECS tasks"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = local.public_container_ports

    content {
      description     = "Public ALB to Plane service port ${ingress.value}"
      from_port       = tonumber(ingress.value)
      to_port         = tonumber(ingress.value)
      protocol        = "tcp"
      security_groups = [aws_security_group.alb.id]
    }
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

resource "aws_lb_target_group" "service" {
  for_each = local.public_services

  name_prefix = each.key == "app" ? "twpa-" : "twpm-"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = each.value.health_path
    port                = tostring(each.value.port)
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200-499"
  }

  tags = { Name = "${local.name}-${each.value.display_name}-tg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.plane.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["app"].arn
  }
}

resource "aws_lb_listener_rule" "service_path" {
  for_each = local.listener_rules

  listener_arn = aws_lb_listener.https.arn
  priority     = each.value.priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.value.service_key].arn
  }

  condition {
    path_pattern {
      values = each.value.path_patterns
    }
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
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "service" {
  for_each = local.container_specs

  name              = "/thinkwork/${var.stage}/plane/${each.value.display_name}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/thinkwork/${var.stage}/plane/${each.value.display_name}" }
}

################################################################################
# ECS Task Definitions and Services
################################################################################

resource "aws_ecs_task_definition" "plane" {
  family                   = local.name
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
    for key, container in local.container_specs :
    {
      name      = "plane-${container.display_name}"
      image     = container.image
      essential = true
      command   = container.command

      portMappings = [
        {
          containerPort = container.port
          hostPort      = container.port
          protocol      = "tcp"
        }
      ]

      environment = container.environment
      secrets     = container.secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service[key].name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = container.display_name
        }
      }
    }
  ])
}

resource "aws_ecs_service" "plane" {
  name            = local.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.plane.arn
  desired_count   = var.runtime_enabled ? var.web_desired_count : 0
  launch_type     = "FARGATE"

  enable_execute_command            = true
  health_check_grace_period_seconds = var.health_check_grace_period_seconds
  wait_for_steady_state             = var.wait_for_steady_state
  force_new_deployment              = true

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.plane.id]
    assign_public_ip = true
  }

  dynamic "load_balancer" {
    for_each = local.public_services

    content {
      target_group_arn = aws_lb_target_group.service[load_balancer.key].arn
      container_name   = "plane-${load_balancer.value.display_name}"
      container_port   = load_balancer.value.port
    }
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = local.name }
}
