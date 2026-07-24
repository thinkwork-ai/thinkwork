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

variable "external_kb_source_arns" {
  description = "Bucket ARNs of customer-owned S3 buckets connected as external KB sources (s3-connect). Read-only grants are added for each ARN and its objects. Empty by default — inert until a bucket is connected."
  type        = list(string)
  default     = []
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

  # The knowledge-base-manager Lambda assumes this role to run connect-time
  # access preflights AS the role Bedrock will crawl with (external S3 KB
  # source R8): a probe under operator/Lambda credentials would prove the
  # wrong identity has access. Principal is the account root with a
  # PrincipalArn condition (not a role-ARN principal) so this policy doesn't
  # depend on the app-tier role existing first.
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalArn"
      values   = ["arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-api-lambda-role"]
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
        Resource = concat(
          [
            "arn:aws:s3:::${var.bucket_name}",
            "arn:aws:s3:::${var.bucket_name}/*",
          ],
          # External s3-connect source buckets (read in place, never written).
          var.external_kb_source_arns,
          [for arn in var.external_kb_source_arns : "${arn}/*"],
        )
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
