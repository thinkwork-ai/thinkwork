################################################################################
# AgentCore Harness — App Module (THINK-311 U4, ship-inert)
#
# IAM surface for the AWS Bedrock AgentCore Harness trial: the execution role
# Harness microVMs assume, plus (via outputs consumed by lambda-api's grouped
# policies) the invoker grants the shared api Lambda role needs to create and
# invoke Harness resources. Nothing reads or invokes any of this until the
# harness-runner handler lands in U5 — this module is pure IAM.
#
# Trust-policy note: sibling agentcore roles (agentcore-pi, agentcore-runtime)
# trust the bare `bedrock-agentcore.amazonaws.com` service principal with no
# account/source-arn conditions; this role mirrors that repo pattern.
################################################################################

################################################################################
# Harness execution role — assumed by Harness microVMs
################################################################################

resource "aws_iam_role" "harness_execution" {
  count = var.enabled ? 1 : 0

  name = "thinkwork-${var.stage}-agentcore-harness-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "thinkwork-${var.stage}-agentcore-harness-role"
  }
}

resource "aws_iam_role_policy" "harness_execution" {
  count = var.enabled ? 1 : 0

  name = "agentcore-harness-permissions"
  role = aws_iam_role.harness_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Cross-region inference profiles (us.anthropic.claude-*) require
        # `bedrock:InvokeModel` on the *inference-profile* ARN AND on the
        # underlying foundation-model ARN in every region the profile can
        # route to — same resource list the api Lambda's grouped ai policy
        # uses (see ../lambda-api/iam-grouped.tf "bedrock-invoke").
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/*",
          "arn:aws:bedrock:*:${var.account_id}:inference-profile/*",
        ]
      },
      {
        # Tenant skill catalog sources + materialized workspace skill folders
        # live under tenants/* in the stage workspace bucket. Read-only —
        # Harness microVMs never write back to the workspace bucket.
        Sid      = "WorkspaceSkillSourcesRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::${var.bucket_name}/tenants/*"
      },
      {
        Sid      = "WorkspaceSkillSourcesList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::${var.bucket_name}"
        Condition = {
          StringLike = {
            "s3:prefix" = "tenants/*"
          }
        }
      },
      {
        # Harness containers log to the service-managed bedrock-agentcore
        # log-group namespace, mirroring the agentcore-pi role's runtimes
        # grant.
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/*",
          "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/*:*",
        ]
      },
    ]
  })
}
