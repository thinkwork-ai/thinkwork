################################################################################
# Hindsight Memory Engine — App Module
#
# Optional ECS Fargate + ALB service for Hindsight long-term memory.
# Only created when memory_engine = "hindsight". When memory_engine = "managed",
# this module creates nothing and AgentCore's built-in memory is used instead.
#
# Hindsight provides retain/recall/reflect tools for cross-thread,
# cross-session organizational memory. It runs local embeddings + reranker
# and uses the shared Aurora PostgreSQL instance with pgvector.
################################################################################

variable "stage" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "db_security_group_id" {
  type = string
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "image_tag" {
  description = "Hindsight Docker image tag (ghcr.io/vectorize-io/hindsight:<tag>)"
  type        = string
  default     = "0.4.22"
}

data "aws_region" "current" {}

################################################################################
# ECS Cluster
################################################################################

resource "aws_ecs_cluster" "main" {
  name = "thinkwork-${var.stage}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "thinkwork-${var.stage}-cluster" }
}

################################################################################
# IAM
################################################################################

resource "aws_iam_role" "ecs_execution" {
  name = "thinkwork-${var.stage}-hindsight-execution"

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

resource "aws_iam_role" "ecs_task" {
  name = "thinkwork-${var.stage}-hindsight-task"

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
  name = "bedrock-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

################################################################################
# Security Groups
################################################################################

resource "aws_security_group" "hindsight" {
  name_prefix = "thinkwork-${var.stage}-hindsight-"
  description = "Hindsight ECS task"
  vpc_id      = var.vpc_id

  ingress {
    description     = "ALB to Hindsight API"
    from_port       = 8888
    to_port         = 8888
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "thinkwork-${var.stage}-hindsight-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "alb" {
  name_prefix = "thinkwork-${var.stage}-hindsight-alb-"
  description = "Hindsight ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "thinkwork-${var.stage}-hindsight-alb-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group_rule" "aurora_from_hindsight" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.hindsight.id
  security_group_id        = var.db_security_group_id
}

################################################################################
# ALB
################################################################################

resource "aws_lb" "hindsight" {
  name               = "tw-${var.stage}-hindsight"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "thinkwork-${var.stage}-hindsight-alb" }
}

resource "aws_lb_target_group" "hindsight" {
  name        = "tw-${var.stage}-hindsight"
  port        = 8888
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    port                = "8888"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200-399"
  }

  tags = { Name = "thinkwork-${var.stage}-hindsight-tg" }
}

resource "aws_lb_listener" "hindsight" {
  load_balancer_arn = aws_lb.hindsight.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hindsight.arn
  }
}

################################################################################
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "hindsight" {
  name              = "/thinkwork/${var.stage}/hindsight"
  retention_in_days = 14

  tags = { Name = "thinkwork-${var.stage}-hindsight-logs" }
}

################################################################################
# ECS Task Definition
################################################################################

resource "aws_ecs_task_definition" "hindsight" {
  family                   = "thinkwork-${var.stage}-hindsight"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 4096
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "hindsight"
    image     = "ghcr.io/vectorize-io/hindsight:${var.image_tag}"
    essential = true

    portMappings = [{
      containerPort = 8888
      protocol      = "tcp"
    }]

    environment = [
      { name = "HINDSIGHT_API_DATABASE_URL", value = var.database_url },
      { name = "HINDSIGHT_API_DATABASE_SCHEMA", value = "hindsight" },
      { name = "HINDSIGHT_API_VECTOR_EXTENSION", value = "pgvector" },
      { name = "HINDSIGHT_API_TEXT_SEARCH_EXTENSION", value = "native" },
      { name = "HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP", value = "true" },
      { name = "HINDSIGHT_API_LLM_PROVIDER", value = "bedrock" },
      { name = "HINDSIGHT_API_LLM_MODEL", value = "openai.gpt-oss-20b-1:0" },
      { name = "AWS_REGION_NAME", value = data.aws_region.current.name },
      { name = "AWS_DEFAULT_REGION", value = data.aws_region.current.name },
      { name = "HINDSIGHT_API_RETAIN_LLM_PROVIDER", value = "bedrock" },
      { name = "HINDSIGHT_API_RETAIN_LLM_MODEL", value = "openai.gpt-oss-20b-1:0" },
      { name = "HINDSIGHT_API_REFLECT_LLM_PROVIDER", value = "bedrock" },
      { name = "HINDSIGHT_API_REFLECT_LLM_MODEL", value = "openai.gpt-oss-120b-1:0" },
      { name = "HINDSIGHT_API_EMBEDDINGS_PROVIDER", value = "local" },
      { name = "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL", value = "BAAI/bge-small-en-v1.5" },
      { name = "HINDSIGHT_API_RERANKER_PROVIDER", value = "local" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.hindsight.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "hindsight"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8888/health || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 300
    }
  }])

  tags = { Name = "thinkwork-${var.stage}-hindsight" }
}

################################################################################
# ECS Service
################################################################################

resource "aws_ecs_service" "hindsight" {
  name            = "thinkwork-${var.stage}-hindsight"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.hindsight.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.hindsight.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.hindsight.arn
    container_name   = "hindsight"
    container_port   = 8888
  }

  depends_on = [aws_lb_listener.hindsight]

  tags = { Name = "thinkwork-${var.stage}-hindsight" }
}

################################################################################
# Outputs
################################################################################

output "hindsight_endpoint" {
  description = "Hindsight API endpoint (ALB URL)"
  value       = "http://${aws_lb.hindsight.dns_name}"
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}
