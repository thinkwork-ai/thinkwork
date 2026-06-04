################################################################################
# Cognee (Optional Ontology/KG Add-On) - App Module
#
# Provisions the phase-1 Cognee substrate as an internal ECS/Fargate service.
# The module intentionally does not expose a public endpoint mode; Thinkwork API
# wrappers own tenant/auth boundaries in follow-up work.
################################################################################

locals {
  name = "thinkwork-${var.stage}-cognee"

  data_root_directory   = "/app/cognee-storage/data"
  system_root_directory = "/app/cognee-storage/system"

  vector_db_url = var.vector_db_url != "" ? var.vector_db_url : "${local.system_root_directory}/databases/cognee.lancedb"
  graph_db_url  = var.graph_database_url != "" ? var.graph_database_url : "${local.system_root_directory}/databases/cognee.kuzu"

  subnet_ids_by_az = {
    for subnet_id, subnet in data.aws_subnet.cognee : subnet.availability_zone => subnet_id...
  }
  efs_mount_subnet_ids = [
    for subnet_ids in local.subnet_ids_by_az : subnet_ids[0]
  ]

  base_environment = [
    { name = "DB_PROVIDER", value = "postgres" },
    { name = "DB_HOST", value = var.db_host },
    { name = "DB_PORT", value = tostring(var.db_port) },
    { name = "DB_NAME", value = var.db_name },
    { name = "DB_USERNAME", value = var.db_username },
    { name = "LLM_PROVIDER", value = var.llm_provider },
    { name = "LLM_MODEL", value = var.llm_model },
    { name = "EMBEDDING_PROVIDER", value = var.embedding_provider },
    { name = "EMBEDDING_MODEL", value = var.embedding_model },
    { name = "EMBEDDING_DIMENSIONS", value = tostring(var.embedding_dimensions) },
    { name = "VECTOR_DB_PROVIDER", value = var.vector_db_provider },
    { name = "VECTOR_DB_URL", value = local.vector_db_url },
    { name = "GRAPH_DATABASE_PROVIDER", value = var.graph_database_provider },
    { name = "GRAPH_DATABASE_URL", value = local.graph_db_url },
    { name = "DATA_ROOT_DIRECTORY", value = local.data_root_directory },
    { name = "SYSTEM_ROOT_DIRECTORY", value = local.system_root_directory },
    { name = "TELEMETRY_DISABLED", value = "true" },
    { name = "REQUIRE_AUTHENTICATION", value = "false" },
    { name = "CORS_ALLOWED_ORIGINS", value = "" },
    { name = "AWS_DEFAULT_REGION", value = data.aws_region.current.region },
    { name = "AWS_REGION", value = data.aws_region.current.region },
  ]

  optional_environment = concat(
    var.embedding_max_completion_tokens != "" ? [{ name = "EMBEDDING_MAX_COMPLETION_TOKENS", value = var.embedding_max_completion_tokens }] : [],
    var.graph_database_username != "" ? [{ name = "GRAPH_DATABASE_USERNAME", value = var.graph_database_username }] : []
  )

  container_secrets = concat(
    [{ name = "DB_PASSWORD", valueFrom = "${var.db_password_secret_arn}:password::" }],
    var.llm_api_key_secret_arn != "" ? [{ name = "LLM_API_KEY", valueFrom = var.llm_api_key_secret_arn }] : [],
    var.embedding_api_key_secret_arn != "" ? [{ name = "EMBEDDING_API_KEY", valueFrom = var.embedding_api_key_secret_arn }] : [],
    var.vector_db_key_secret_arn != "" ? [{ name = "VECTOR_DB_KEY", valueFrom = var.vector_db_key_secret_arn }] : [],
    var.graph_database_password_secret_arn != "" ? [{ name = "GRAPH_DATABASE_PASSWORD", valueFrom = var.graph_database_password_secret_arn }] : []
  )

  secret_arns = compact([
    var.db_password_secret_arn,
    var.llm_api_key_secret_arn,
    var.embedding_api_key_secret_arn,
    var.vector_db_key_secret_arn,
    var.graph_database_password_secret_arn,
  ])
}

data "aws_region" "current" {}

data "aws_subnet" "cognee" {
  for_each = toset(var.subnet_ids)

  id = each.value
}

################################################################################
# Plan-time safety guardrails
################################################################################

resource "terraform_data" "configuration_guardrails" {
  input = {
    backend_mode                 = var.backend_mode
    desired_count                = var.desired_count
    vector_db_url                = var.vector_db_url
    graph_database_url           = var.graph_database_url
    llm_provider                 = var.llm_provider
    embedding_provider           = var.embedding_provider
    llm_api_key_secret_arn       = var.llm_api_key_secret_arn
    embedding_api_key_secret_arn = var.embedding_api_key_secret_arn
    bedrock_model_resource_arns  = var.bedrock_model_resource_arns
  }

  lifecycle {
    precondition {
      condition     = var.backend_mode != "dogfood" || var.desired_count == 1
      error_message = "dogfood backend mode uses local graph/vector storage and must run with desired_count = 1."
    }

    precondition {
      condition     = var.backend_mode != "remote" || (var.vector_db_url != "" && var.graph_database_url != "")
      error_message = "remote backend mode requires both vector_db_url and graph_database_url."
    }

    precondition {
      condition = (
        var.llm_provider == "bedrock" || var.llm_api_key_secret_arn != ""
        ) && (
        var.embedding_provider == "bedrock" || var.embedding_api_key_secret_arn != ""
      )
      error_message = "Non-Bedrock LLM or embedding providers must use Secrets Manager ARNs, not plaintext environment values."
    }

    precondition {
      condition = (
        (var.llm_provider != "bedrock" && var.embedding_provider != "bedrock") ||
        length(var.bedrock_model_resource_arns) > 0
      )
      error_message = "Bedrock LLM or embedding providers require explicit bedrock_model_resource_arns."
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
  name = "cognee-secrets"
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

resource "aws_iam_role_policy" "bedrock_access" {
  count = var.llm_provider == "bedrock" || var.embedding_provider == "bedrock" ? 1 : 0

  name = "bedrock-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = var.bedrock_model_resource_arns
    }]
  })
}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "cognee" {
  name_prefix = "${local.name}-"
  description = "Cognee ECS task"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Internal ALB to Cognee API"
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
  description = "Internal Cognee ALB"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = var.allowed_internal_cidr_blocks

    content {
      description = "Allowed internal caller CIDR"
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  dynamic "ingress" {
    for_each = var.allowed_internal_security_group_ids

    content {
      description     = "Allowed internal caller security group"
      from_port       = 80
      to_port         = 80
      protocol        = "tcp"
      security_groups = [ingress.value]
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
  description = "Cognee EFS storage"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Cognee task to EFS"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.cognee.id]
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

resource "aws_security_group_rule" "aurora_from_cognee" {
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.cognee.id
  security_group_id        = var.db_security_group_id
}

################################################################################
# ALB
################################################################################

resource "aws_lb" "cognee" {
  name               = "tw-${var.stage}-cognee"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "cognee" {
  name        = "tw-${var.stage}-cognee"
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

resource "aws_lb_listener" "cognee" {
  load_balancer_arn = aws_lb.cognee.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.cognee.arn
  }
}

################################################################################
# Persistent writable storage
################################################################################

resource "aws_efs_file_system" "cognee" {
  creation_token = local.name
  encrypted      = true

  tags = { Name = "${local.name}-efs" }
}

resource "aws_efs_mount_target" "cognee" {
  for_each = toset(local.efs_mount_subnet_ids)

  file_system_id  = aws_efs_file_system.cognee.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

################################################################################
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "cognee" {
  name              = "/thinkwork/${var.stage}/cognee"
  retention_in_days = var.log_retention_days

  tags = { Name = "${local.name}-logs" }
}

################################################################################
# ECS Task Definition
################################################################################

resource "aws_ecs_task_definition" "cognee" {
  family                   = local.name
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
    name = "cognee-storage"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.cognee.id
      transit_encryption = "ENABLED"
    }
  }

  container_definitions = jsonencode([{
    name      = "cognee"
    image     = var.image_uri
    essential = true

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = concat(local.base_environment, local.optional_environment)
    secrets     = local.container_secrets

    mountPoints = [{
      sourceVolume  = "cognee-storage"
      containerPath = "/app/cognee-storage"
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.cognee.name
        "awslogs-region"        = data.aws_region.current.region
        "awslogs-stream-prefix" = "cognee"
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

  depends_on = [aws_efs_mount_target.cognee, terraform_data.configuration_guardrails]

  tags = { Name = local.name }
}

################################################################################
# ECS Service
################################################################################

resource "aws_ecs_service" "cognee" {
  name            = local.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.cognee.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = var.backend_mode == "dogfood" ? 0 : 100
  deployment_maximum_percent         = var.backend_mode == "dogfood" ? 100 : 200
  health_check_grace_period_seconds  = var.health_check_grace_period_seconds
  wait_for_steady_state              = var.wait_for_steady_state

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.cognee.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.cognee.arn
    container_name   = "cognee"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.cognee, terraform_data.configuration_guardrails]

  tags = { Name = local.name }
}
