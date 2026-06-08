################################################################################
# Deployment Control Plane — App Module
#
# AWS-native substrate for GitHub-free customer deployments. Step Functions
# invokes CodeBuild, passes session metadata, stages release artifacts, runs
# Terraform, and records evidence.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  name_prefix              = "thinkwork-${var.stage}-deployment"
  evidence_bucket_name     = "thinkwork-${var.stage}-${var.account_id}-deploy-evidence"
  ssm_prefix               = "/thinkwork/${var.stage}/deployment"
  appconfig_name           = "thinkwork-${var.stage}-deployment"
  configuration_profile    = "deployment-config"
  state_machine_name       = "${local.name_prefix}-orchestrator"
  codebuild_project_name   = "${local.name_prefix}-runner"
  codebuild_log_group      = "/aws/codebuild/${local.codebuild_project_name}"
  state_machine_log_group  = "/aws/vendedlogs/states/${local.state_machine_name}"
  terraform_module_is_git  = startswith(var.terraform_module_source, "git::") || startswith(var.terraform_module_source, "github.com/")
  terraform_module_version = var.terraform_module_version != "" ? var.terraform_module_version : (local.terraform_module_is_git ? "" : trimprefix(var.release_version, "v"))

  deployment_parameters = {
    for key, value in {
      selected_release_version         = var.release_version
      selected_release_manifest_url    = var.release_manifest_url
      selected_release_manifest_sha256 = var.release_manifest_sha256
      terraform_state_bucket           = var.terraform_state_bucket
      terraform_lock_table             = var.terraform_lock_table
      release_artifact_bucket          = var.release_artifact_bucket
      terraform_module_source          = var.terraform_module_source
      terraform_module_version         = local.terraform_module_version
    } : key => value if value != ""
  }

  secret_placeholders = {
    idp_client_secret = {
      name        = "${local.ssm_prefix}/idp-client-secret"
      description = "Placeholder for the customer identity provider client secret."
    }
    runner_environment = {
      name        = "${local.ssm_prefix}/runner-secrets"
      description = "Placeholder for deployment runner secret material."
    }
  }
}

resource "aws_s3_bucket" "evidence" {
  bucket = local.evidence_bucket_name

  tags = {
    Name    = local.evidence_bucket_name
    Stage   = var.stage
    Purpose = "deployment-evidence"
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudwatch_log_group" "codebuild" {
  name              = local.codebuild_log_group
  retention_in_days = var.log_retention_days

  tags = {
    Name    = local.codebuild_log_group
    Stage   = var.stage
    Purpose = "deployment-runner"
  }
}

resource "aws_cloudwatch_log_group" "state_machine" {
  name              = local.state_machine_log_group
  retention_in_days = var.log_retention_days

  tags = {
    Name    = local.state_machine_log_group
    Stage   = var.stage
    Purpose = "deployment-orchestrator"
  }
}

resource "aws_appconfig_application" "deployment" {
  name        = local.appconfig_name
  description = "ThinkWork deployment configuration for ${var.stage}."

  tags = {
    Name    = local.appconfig_name
    Stage   = var.stage
    Purpose = "deployment-config"
  }
}

resource "aws_appconfig_environment" "deployment" {
  application_id = aws_appconfig_application.deployment.id
  name           = var.stage
  description    = "ThinkWork deployment configuration environment for ${var.stage}."

  tags = {
    Name    = "${local.appconfig_name}-${var.stage}"
    Stage   = var.stage
    Purpose = "deployment-config"
  }
}

resource "aws_appconfig_configuration_profile" "deployment" {
  application_id = aws_appconfig_application.deployment.id
  name           = local.configuration_profile
  location_uri   = "hosted"
  description    = "Versioned non-secret deployment configuration."

  tags = {
    Name    = "${local.appconfig_name}-${local.configuration_profile}"
    Stage   = var.stage
    Purpose = "deployment-config"
  }
}

resource "aws_ssm_parameter" "deployment" {
  for_each = local.deployment_parameters

  name      = "${local.ssm_prefix}/${replace(each.key, "_", "-")}"
  type      = "String"
  value     = each.value
  overwrite = true

  tags = {
    Name    = "${local.ssm_prefix}/${replace(each.key, "_", "-")}"
    Stage   = var.stage
    Purpose = "deployment-release-pin"
  }
}

resource "aws_secretsmanager_secret" "deployment" {
  for_each = var.create_secret_placeholders ? local.secret_placeholders : {}

  name        = each.value.name
  description = each.value.description

  tags = {
    Name    = each.value.name
    Stage   = var.stage
    Purpose = "deployment-secret-placeholder"
  }
}

resource "aws_secretsmanager_secret_version" "deployment" {
  for_each = aws_secretsmanager_secret.deployment

  secret_id = each.value.id
  secret_string = jsonencode({
    value = "PLACEHOLDER_SET_VIA_THINKWORK_BOOTSTRAP"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_iam_role" "codebuild" {
  name = "${local.name_prefix}-codebuild-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })

  tags = {
    Name    = "${local.name_prefix}-codebuild-role"
    Stage   = var.stage
    Purpose = "deployment-runner"
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name = "deployment-runner"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.codebuild.arn}:*"
      },
      {
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.evidence.arn,
          "${aws_s3_bucket.evidence.arn}/*",
          "arn:aws:s3:::${var.terraform_state_bucket}",
          "arn:aws:s3:::${var.terraform_state_bucket}/*",
          "arn:aws:s3:::${var.release_artifact_bucket}",
          "arn:aws:s3:::${var.release_artifact_bucket}/*",
          "arn:aws:s3:::thinkwork-${var.stage}-*",
          "arn:aws:s3:::thinkwork-${var.stage}-*/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ]
        Resource = "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.terraform_lock_table}"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:PutParameter",
        ]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter${local.ssm_prefix}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "appconfig:GetConfiguration",
          "appconfig:StartConfigurationSession",
          "appconfig:GetLatestConfiguration",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = concat(
          [for secret in aws_secretsmanager_secret.deployment : secret.arn],
          ["arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/${var.stage}/deployment/*"]
        )
      },
      {
        Effect = "Allow"
        Action = [
          "acm:*",
          "apigateway:*",
          "appsync:*",
          "bedrock:*",
          "bedrock-agentcore:*",
          "cloudfront:*",
          "cloudwatch:*",
          "cognito-identity:*",
          "cognito-idp:*",
          "dynamodb:*",
          "ec2:*",
          "ecr:*",
          "ecs:*",
          "elasticfilesystem:*",
          "elasticloadbalancing:*",
          "events:*",
          "iam:*",
          "kms:*",
          "lambda:*",
          "logs:*",
          "rds:*",
          "scheduler:*",
          "secretsmanager:*",
          "ses:*",
          "sqs:*",
          "ssm:*",
          "states:*",
          "xray:*",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_codebuild_project" "runner" {
  name          = local.codebuild_project_name
  description   = "ThinkWork deployment runner for ${var.stage}."
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 480

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/standard:7.0"
    privileged_mode             = true
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "THINKWORK_STAGE"
      value = var.stage
    }

    environment_variable {
      name  = "THINKWORK_RELEASE_VERSION"
      value = var.release_version
    }

    environment_variable {
      name  = "THINKWORK_EVIDENCE_BUCKET"
      value = aws_s3_bucket.evidence.bucket
    }

    environment_variable {
      name  = "THINKWORK_TERRAFORM_STATE_BUCKET"
      value = var.terraform_state_bucket
    }

    environment_variable {
      name  = "THINKWORK_TERRAFORM_LOCK_TABLE"
      value = var.terraform_lock_table
    }

    environment_variable {
      name  = "THINKWORK_RELEASE_ARTIFACT_BUCKET"
      value = var.release_artifact_bucket
    }

    environment_variable {
      name  = "THINKWORK_RELEASE_MANIFEST_URL"
      value = var.release_manifest_url
    }

    environment_variable {
      name  = "THINKWORK_RELEASE_MANIFEST_SHA256"
      value = var.release_manifest_sha256
    }

    environment_variable {
      name  = "THINKWORK_TERRAFORM_MODULE_SOURCE"
      value = var.terraform_module_source
    }

    environment_variable {
      name  = "THINKWORK_TERRAFORM_MODULE_VERSION"
      value = local.terraform_module_version
    }

    environment_variable {
      name  = "THINKWORK_SSM_PREFIX"
      value = local.ssm_prefix
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild.name
      status     = "ENABLED"
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = file("${path.module}/buildspec.yml")
  }

  tags = {
    Name    = local.codebuild_project_name
    Stage   = var.stage
    Purpose = "deployment-runner"
  }
}

resource "aws_iam_role" "state_machine" {
  name = "${local.name_prefix}-sfn-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })

  tags = {
    Name    = "${local.name_prefix}-sfn-role"
    Stage   = var.stage
    Purpose = "deployment-orchestrator"
  }
}

resource "aws_iam_role_policy" "state_machine" {
  name = "deployment-orchestrator"
  role = aws_iam_role.state_machine.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "codebuild:StartBuild",
          "codebuild:StopBuild",
          "codebuild:BatchGetBuilds",
        ]
        Resource = aws_codebuild_project.runner.arn
      },
      {
        Effect = "Allow"
        Action = [
          "events:PutTargets",
          "events:PutRule",
          "events:DescribeRule",
        ]
        Resource = "arn:aws:events:${var.region}:${var.account_id}:rule/StepFunctionsGetEventForCodeBuildStartBuildRule"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_sfn_state_machine" "deployment" {
  name     = local.state_machine_name
  role_arn = aws_iam_role.state_machine.arn

  logging_configuration {
    include_execution_data = false
    level                  = "ALL"
    log_destination        = "${aws_cloudwatch_log_group.state_machine.arn}:*"
  }

  definition = jsonencode({
    Comment = "ThinkWork deployment control plane. Runs release-pinned Terraform from CodeBuild and records evidence."
    StartAt = "RunDeployment"
    States = {
      RunDeployment = {
        Type     = "Task"
        Resource = "arn:aws:states:::codebuild:startBuild.sync"
        Parameters = {
          ProjectName = aws_codebuild_project.runner.name
          EnvironmentVariablesOverride = [
            {
              Name      = "THINKWORK_DEPLOYMENT_ACTION"
              Type      = "PLAINTEXT"
              "Value.$" = "$.action"
            },
            {
              Name      = "THINKWORK_DEPLOYMENT_SESSION_ID"
              Type      = "PLAINTEXT"
              "Value.$" = "$.sessionId"
            },
            {
              Name      = "THINKWORK_DEPLOYMENT_INPUT"
              Type      = "PLAINTEXT"
              "Value.$" = "States.JsonToString($)"
            },
            {
              Name      = "THINKWORK_EVIDENCE_PREFIX"
              Type      = "PLAINTEXT"
              "Value.$" = "States.Format('sessions/{}/{}', $.sessionId, $.action)"
            },
          ]
        }
        End = true
      }
    }
  })

  tags = {
    Name    = local.state_machine_name
    Stage   = var.stage
    Purpose = "deployment-orchestrator"
  }
}
