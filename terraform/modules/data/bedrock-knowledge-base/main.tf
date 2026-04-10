################################################################################
# Bedrock Knowledge Base — Data Module
#
# Creates the IAM service role that Bedrock Knowledge Bases need to access
# S3 documents, invoke Titan embeddings, use RDS Data API, and read secrets.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name for knowledge base documents"
  type        = string
}

data "aws_iam_policy_document" "kb_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_iam_role" "kb_service" {
  name               = "thinkwork-${var.stage}-kb-service-role"
  assume_role_policy = data.aws_iam_policy_document.kb_assume.json
}

resource "aws_iam_role_policy" "kb_permissions" {
  name = "knowledge-base-permissions"
  role = aws_iam_role.kb_service.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ReadDocs"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_name}",
          "arn:aws:s3:::${var.bucket_name}/*",
        ]
      },
      {
        Sid    = "BedrockEmbedding"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
      },
      {
        Sid    = "RDSDataAPI"
        Effect = "Allow"
        Action = [
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement",
        ]
        Resource = "*"
      },
      {
        Sid    = "RDSDescribe"
        Effect = "Allow"
        Action = ["rds:DescribeDBClusters"]
        Resource = "*"
      },
      {
        Sid    = "SecretsManager"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = "*"
      },
    ]
  })
}

output "kb_service_role_arn" {
  description = "IAM role ARN for Bedrock Knowledge Base service"
  value       = aws_iam_role.kb_service.arn
}
