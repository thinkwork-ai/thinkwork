# Capability Broker (THINK-280 U3) — action-time policy, replay-safe PoP
# sessions, and evidence for the governed capability runtime.
#
# SHIP-INERT: gated by var.enabled (default false). Nothing here is created
# until U4 flips it on after the live negative-egress proof. The Lambda code
# itself also fails closed — its default authorization loader denies every
# call — so even an accidental enable dispatches no provider operation.
#
# THINK-144: this module owns a DEDICATED execute-api interface VPC endpoint
# with private DNS DISABLED. It is never added to the app VPC's shared
# okf_wiki_interface_endpoint_services list — that list's private DNS would
# capture every *.execute-api call in the VPC and 403 the stack's public HTTP
# APIs. The session bootstrap targets this endpoint's own DNS name instead.

locals {
  enabled       = var.enabled
  count_enabled = var.enabled ? 1 : 0

  name_prefix           = "thinkwork-${var.stage}-capability-broker"
  session_table_name    = "thinkwork-${var.stage}-capability-broker-sessions"
  broker_audience       = "thinkwork-${var.stage}-capability-broker"
  use_local_zips        = var.lambda_zips_dir != ""
  use_remote_artifacts  = trimspace(var.lambda_artifact_bucket) != ""
  broker_zip_local      = "${var.lambda_zips_dir}/capability-broker.zip"
  broker_artifact_s3key = "${var.lambda_artifact_prefix}/capability-broker.zip"
}

# --- Replay-safe session state (DynamoDB, conditional writes + TTL) ----------

resource "aws_dynamodb_table" "sessions" {
  count = local.count_enabled

  name         = local.session_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Session + nonce records self-expire at session TTL (≤15 min). Epoch seconds.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name    = local.session_table_name
    Purpose = "capability-broker-sessions"
  }
}

# --- Broker Lambda execution role -------------------------------------------

data "aws_iam_policy_document" "broker_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "broker" {
  count              = local.count_enabled
  name               = "${local.name_prefix}-role"
  assume_role_policy = data.aws_iam_policy_document.broker_assume.json
}

data "aws_iam_policy_document" "broker_policy" {
  count = local.count_enabled

  # Session state: conditional reads/writes only, scoped to the one table.
  statement {
    sid = "SessionState"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.sessions[0].arn]
  }

  # Evidence: append capability_broker_calls rows via the RDS Data API on the
  # existing Aurora cluster (same credential-rotation surface as graphql-http).
  dynamic "statement" {
    for_each = var.db_cluster_arn != "" ? [1] : []
    content {
      sid       = "EvidenceDataApi"
      actions   = ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement"]
      resources = [var.db_cluster_arn]
    }
  }

  dynamic "statement" {
    for_each = var.db_secret_arn != "" ? [1] : []
    content {
      sid       = "EvidenceDbSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [var.db_secret_arn]
    }
  }

  # VPC ENI management for the in-VPC Lambda.
  statement {
    sid = "VpcEni"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.name_prefix}*"]
  }

  statement {
    sid       = "Xray"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "broker" {
  count  = local.count_enabled
  name   = "${local.name_prefix}-policy"
  role   = aws_iam_role.broker[0].id
  policy = data.aws_iam_policy_document.broker_policy[0].json
}

# --- Broker Lambda security group (egress only) ------------------------------

resource "aws_security_group" "broker_lambda" {
  count       = local.count_enabled
  name        = "${local.name_prefix}-lambda"
  description = "Capability broker Lambda egress"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Egress to Aurora Data API, DynamoDB, Secrets Manager, provider endpoints"
  }

  tags = { Name = "${local.name_prefix}-lambda" }
}

resource "aws_cloudwatch_log_group" "broker" {
  count             = local.count_enabled
  name              = "/aws/lambda/${local.name_prefix}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "broker" {
  count         = local.count_enabled
  function_name = local.name_prefix
  role          = aws_iam_role.broker[0].arn
  runtime       = var.lambda_runtime
  handler       = "index.handler"
  timeout       = 30
  memory_size   = 512

  filename         = local.use_local_zips ? local.broker_zip_local : null
  source_code_hash = local.use_local_zips ? filebase64sha256(local.broker_zip_local) : null
  s3_bucket        = local.use_remote_artifacts ? var.lambda_artifact_bucket : null
  s3_key           = local.use_remote_artifacts ? local.broker_artifact_s3key : null

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.broker_lambda[0].id]
  }

  environment {
    variables = {
      CAPABILITY_BROKER_SESSION_TABLE = aws_dynamodb_table.sessions[0].name
      CAPABILITY_BROKER_AUDIENCE      = local.broker_audience
      DB_CLUSTER_ARN                  = var.db_cluster_arn
      DB_SECRET_ARN                   = var.db_secret_arn
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.broker]
}

# --- Private REST API Gateway fronting the broker ----------------------------
#
# PRIVATE endpoint: reachable ONLY through the dedicated execute-api VPCE below.
# The resource policy denies anything not arriving via that endpoint.

resource "aws_api_gateway_rest_api" "broker" {
  count = local.count_enabled
  name  = local.name_prefix

  endpoint_configuration {
    types            = ["PRIVATE"]
    vpc_endpoint_ids = [aws_vpc_endpoint.broker_execute_api[0].id]
  }

  # Only traffic arriving through our own VPCE is allowed; everything else 403s.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Deny"
        Principal = "*"
        Action    = "execute-api:Invoke"
        Resource  = "arn:aws:execute-api:${var.region}:${var.account_id}:*/*/*/*"
        Condition = {
          StringNotEquals = { "aws:SourceVpce" = aws_vpc_endpoint.broker_execute_api[0].id }
        }
      },
      {
        Effect    = "Allow"
        Principal = "*"
        Action    = "execute-api:Invoke"
        Resource  = "arn:aws:execute-api:${var.region}:${var.account_id}:*/*/*/*"
      },
    ]
  })
}

resource "aws_api_gateway_resource" "broker_proxy" {
  count       = local.count_enabled
  rest_api_id = aws_api_gateway_rest_api.broker[0].id
  parent_id   = aws_api_gateway_rest_api.broker[0].root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "broker_any" {
  count         = local.count_enabled
  rest_api_id   = aws_api_gateway_rest_api.broker[0].id
  resource_id   = aws_api_gateway_resource.broker_proxy[0].id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "broker" {
  count                   = local.count_enabled
  rest_api_id             = aws_api_gateway_rest_api.broker[0].id
  resource_id             = aws_api_gateway_resource.broker_proxy[0].id
  http_method             = aws_api_gateway_method.broker_any[0].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.broker[0].invoke_arn
}

resource "aws_lambda_permission" "broker_apigw" {
  count         = local.count_enabled
  statement_id  = "AllowBrokerPrivateApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.broker[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.broker[0].execution_arn}/*/*/*"
}

resource "aws_api_gateway_deployment" "broker" {
  count       = local.count_enabled
  rest_api_id = aws_api_gateway_rest_api.broker[0].id

  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.broker_proxy[0].id,
      aws_api_gateway_method.broker_any[0].id,
      aws_api_gateway_integration.broker[0].id,
      aws_api_gateway_rest_api.broker[0].policy,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
  depends_on = [aws_api_gateway_integration.broker]
}

resource "aws_api_gateway_stage" "broker" {
  count         = local.count_enabled
  rest_api_id   = aws_api_gateway_rest_api.broker[0].id
  deployment_id = aws_api_gateway_deployment.broker[0].id
  stage_name    = var.stage
}

# --- Dedicated execute-api VPC endpoint (PRIVATE DNS DISABLED — THINK-144) ----

resource "aws_security_group" "broker_vpce" {
  count       = local.count_enabled
  name        = "${local.name_prefix}-vpce"
  description = "Capability broker execute-api VPCE (broker Lambda + capability-private interpreter subnet only)"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
    description = "HTTPS from in-VPC PoP callers (broker Lambda self-calls + U4 capability-private interpreter)"
  }

  tags = { Name = "${local.name_prefix}-vpce" }
}

resource "aws_vpc_endpoint" "broker_execute_api" {
  count = local.count_enabled

  vpc_id             = var.vpc_id
  service_name       = "com.amazonaws.${var.region}.execute-api"
  vpc_endpoint_type  = "Interface"
  subnet_ids         = var.subnet_ids
  security_group_ids = [aws_security_group.broker_vpce[0].id]

  # CRITICAL (THINK-144): private DNS OFF. Callers target the endpoint-specific
  # DNS name (surfaced as an output), never the regional execute-api domain, so
  # this endpoint cannot capture the stack's public HTTP API traffic.
  private_dns_enabled = false

  tags = {
    Name    = "${local.name_prefix}-execute-api-vpce"
    Purpose = "capability-broker-private-ingress"
  }
}
