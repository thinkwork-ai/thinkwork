################################################################################
# Kestra (Optional Managed App) - App Module
#
# Provisions Kestra as an AWS-native ECS/Fargate runtime with public HTTPS ALB,
# Postgres-backed repository/queue state, S3 internal storage, and basic-auth
# credentials injected from Secrets Manager.
################################################################################

locals {
  name = "thinkwork-${var.stage}-kestra"

  effective_db_password_secret_arn = (
    var.db_password_secret_arn != ""
    ? var.db_password_secret_arn
    : try(aws_secretsmanager_secret.kestra["db_password"].arn, "")
  )
  effective_basic_auth_secret_arn = (
    var.basic_auth_secret_arn != ""
    ? var.basic_auth_secret_arn
    : try(aws_secretsmanager_secret.kestra["basic_auth"].arn, "")
  )

  managed_secret_specs = {
    db_password = {
      enabled       = var.create_secret_placeholders && var.db_password_secret_arn == ""
      name          = "thinkwork/${var.stage}/kestra/db-password"
      description   = "Dedicated Kestra PostgreSQL password"
      secret_string = jsonencode({ password = "PLACEHOLDER_SET_VIA_CI" })
    }
    basic_auth = {
      enabled     = var.create_secret_placeholders && var.basic_auth_secret_arn == ""
      name        = "thinkwork/${var.stage}/kestra/basic-auth"
      description = "Kestra UI/API basic-auth service credential"
      secret_string = jsonencode({
        username = "admin@thinkwork.local"
        password = "PLACEHOLDER_SET_VIA_CI"
      })
    }
  }

  managed_secrets = {
    for key, spec in local.managed_secret_specs : key => spec if spec.enabled
  }

  secret_arns = compact([
    local.effective_db_password_secret_arn,
    local.effective_basic_auth_secret_arn,
  ])

  storage_bucket_name = (
    var.storage_bucket_name != ""
    ? var.storage_bucket_name
    : substr("tw-${var.stage}-kestra-${data.aws_caller_identity.current.account_id}", 0, 63)
  )

  public_url_with_slash = "${var.public_url}/"

  kestra_configuration = <<-YAML
    datasources:
      postgres:
        url: jdbc:postgresql://${var.db_host}:${var.db_port}/${var.db_name}
        driver-class-name: org.postgresql.Driver
        username: ${var.db_username}
        password: $${KESTRA_DB_PASSWORD}
    kestra:
      server:
        basic-auth:
          username: $${KESTRA_BASIC_AUTH_USERNAME}
          password: $${KESTRA_BASIC_AUTH_PASSWORD}
      repository:
        type: postgres
      queue:
        type: postgres
      storage:
        type: s3
        s3:
          region: ${data.aws_region.current.region}
          bucket: ${aws_s3_bucket.kestra.bucket}
      tasks:
        tmp-dir:
          path: /tmp/kestra-wd/tmp
        scripts:
          docker:
            volume-enabled: false
      url: ${local.public_url_with_slash}
  YAML

  container_environment = [
    { name = "KESTRA_CONFIGURATION", value = local.kestra_configuration },
    { name = "JAVA_OPTS", value = var.java_opts },
    { name = "AWS_DEFAULT_REGION", value = data.aws_region.current.region },
    { name = "AWS_REGION", value = data.aws_region.current.region },
  ]

  container_secrets = [
    {
      name      = "KESTRA_DB_PASSWORD"
      valueFrom = "${local.effective_db_password_secret_arn}:password::"
    },
    {
      name      = "KESTRA_BASIC_AUTH_USERNAME"
      valueFrom = "${local.effective_basic_auth_secret_arn}:username::"
    },
    {
      name      = "KESTRA_BASIC_AUTH_PASSWORD"
      valueFrom = "${local.effective_basic_auth_secret_arn}:password::"
    },
  ]
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_secretsmanager_secret" "kestra" {
  for_each = local.managed_secrets

  name        = each.value.name
  description = each.value.description

  tags = {
    Name = each.value.name
    Role = "kestra"
  }
}

resource "aws_secretsmanager_secret_version" "kestra" {
  for_each = local.managed_secrets

  secret_id     = aws_secretsmanager_secret.kestra[each.key].id
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
    runtime_enabled       = var.runtime_enabled
    desired_count         = var.desired_count
    image_uri             = var.image_uri
    public_url            = var.public_url
    certificate_arn       = var.certificate_arn
    db_username           = var.db_username
    db_password_secret    = local.effective_db_password_secret_arn
    basic_auth_secret_arn = local.effective_basic_auth_secret_arn
    storage_bucket_name   = aws_s3_bucket.kestra.bucket
  }

  lifecycle {
    precondition {
      condition     = !var.runtime_enabled || var.desired_count > 0
      error_message = "runtime_enabled requires desired_count > 0."
    }

    precondition {
      condition     = local.effective_db_password_secret_arn != ""
      error_message = "Kestra requires db_password_secret_arn or create_secret_placeholders = true."
    }

    precondition {
      condition     = local.effective_basic_auth_secret_arn != ""
      error_message = "Kestra requires basic_auth_secret_arn or create_secret_placeholders = true."
    }
  }
}

################################################################################
# S3 internal storage
################################################################################

resource "aws_s3_bucket" "kestra" {
  bucket        = local.storage_bucket_name
  force_destroy = var.storage_force_destroy

  tags = {
    Name = local.storage_bucket_name
    Role = "kestra-storage"
  }
}

resource "aws_s3_bucket_public_access_block" "kestra" {
  bucket = aws_s3_bucket.kestra.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kestra" {
  bucket = aws_s3_bucket.kestra.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "kestra" {
  bucket = aws_s3_bucket.kestra.id

  versioning_configuration {
    status = var.storage_versioning_enabled ? "Enabled" : "Suspended"
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
  name = "kestra-secrets"
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

resource "aws_iam_role_policy" "ecs_task_storage" {
  name = "kestra-storage"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation",
        ]
        Resource = aws_s3_bucket.kestra.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
        ]
        Resource = "${aws_s3_bucket.kestra.arn}/*"
      },
    ]
  })
}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "kestra" {
  name_prefix = "${local.name}-"
  description = "Kestra ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Public ALB to Kestra API/UI"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Public ALB to Kestra management health"
    from_port       = var.management_port
    to_port         = var.management_port
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
  description = "Public Kestra ALB"
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

resource "aws_security_group_rule" "aurora_from_kestra" {
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.kestra.id
  security_group_id        = var.db_security_group_id
}

################################################################################
# Public ALB
################################################################################

resource "aws_lb" "kestra" {
  name               = "tw-${var.stage}-kestra"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "kestra" {
  name        = "tw-${var.stage}-kestra"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = var.health_check_path
    port                = tostring(var.management_port)
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
  load_balancer_arn = aws_lb.kestra.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.kestra.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.enable_http_redirect ? 1 : 0

  load_balancer_arn = aws_lb.kestra.arn
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
# ECS task and service
################################################################################

resource "aws_cloudwatch_log_group" "kestra" {
  name              = "/thinkwork/${var.stage}/kestra"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-logs" }
}

resource "aws_ecs_task_definition" "kestra" {
  family                   = "${local.name}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    cpu_architecture        = var.cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "kestra"
      image     = var.image_uri
      essential = true
      command = [
        "server",
        "standalone",
        "--worker-thread=${var.worker_thread_count}",
      ]
      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        },
        {
          containerPort = var.management_port
          hostPort      = var.management_port
          protocol      = "tcp"
        },
      ]
      environment = local.container_environment
      secrets     = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.kestra.name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = "kestra"
        }
      }
    }
  ])

  tags = { Name = "${local.name}-task" }
}

resource "aws_ecs_service" "kestra" {
  name                               = "${local.name}-service"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.kestra.arn
  desired_count                      = var.runtime_enabled ? var.desired_count : 0
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = var.health_check_grace_period_seconds
  wait_for_steady_state              = var.wait_for_steady_state && var.runtime_enabled
  deployment_minimum_healthy_percent = var.runtime_enabled ? 100 : 0
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.kestra.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.kestra.arn
    container_name   = "kestra"
    container_port   = var.container_port
  }

  depends_on = [
    aws_lb_listener.https,
    aws_s3_bucket_public_access_block.kestra,
    aws_s3_bucket_server_side_encryption_configuration.kestra,
  ]

  tags = { Name = "${local.name}-service" }
}
