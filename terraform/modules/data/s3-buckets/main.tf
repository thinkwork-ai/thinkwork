################################################################################
# S3 Buckets — Data Module
#
# Creates the primary S3 bucket for skills, artifacts, knowledge base docs,
# and email inbound storage. HTTPS-only enforcement + SES inbound policy.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "bucket_name" {
  description = "Name of the S3 bucket"
  type        = string
}

variable "cors_allowed_origins" {
  description = "Allowed CORS origins. Use [\"*\"] for development."
  type        = list(string)
  default     = ["*"]
}

resource "aws_s3_bucket" "main" {
  bucket = var.bucket_name

  tags = {
    Name  = "thinkwork-${var.stage}-storage"
    Stage = var.stage
  }
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  cors_rule {
    allowed_headers = ["Content-Type", "Authorization", "x-amz-*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_notification" "eventbridge" {
  bucket      = aws_s3_bucket.main.id
  eventbridge = true
}

resource "aws_s3_bucket_policy" "https_only" {
  bucket = aws_s3_bucket.main.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceHTTPS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.main.arn,
          "${aws_s3_bucket.main.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid    = "AllowSESInbound"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.main.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = var.account_id
          }
        }
      },
    ]
  })
}

output "bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.main.id
}

output "bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.main.arn
}

# Janitor for the RETIRED analyst query broker's staged results. The broker
# is gone, but stages that ran it still hold CSVs under analyst-staging/.
# Keeping the expiry rule drains them; deleting it would strand that data
# with no TTL. Safe to remove once every stage's prefix is empty.
resource "aws_s3_bucket_lifecycle_configuration" "analyst_staging" {
  bucket = aws_s3_bucket.main.id

  rule {
    id     = "analyst-staging-ttl"
    status = "Enabled"

    filter {
      prefix = "analyst-staging/"
    }

    expiration {
      days = 3
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
