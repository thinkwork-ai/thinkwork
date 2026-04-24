################################################################################
# S3 Backups Bucket — Data Module
#
# Separate bucket for pre-destructive-migration CSV exports and other
# operational snapshots. Distinct from the primary storage bucket because:
#
#   - No CORS (client browsers never read this bucket)
#   - Block public access fully (public-access tickets cannot accidentally
#     grant access via aws_s3_bucket_public_access_block)
#   - Server-side encryption on by default
#   - Lifecycle rule auto-expires `pre-drop/` objects after 90 days so cost
#     stays bounded without a separate sweeper
#   - HTTPS-only bucket policy
#
# Used by:
#   - packages/database-pg/drizzle/0027_thread_cleanup_drops.sql (U5 of the
#     thread-detail cleanup plan) via `aws_s3.query_export_to_s3` calls.
#   - Any future destructive migration that wants a pre-apply row-data
#     snapshot.
#
# Pairs with an IAM role on the Aurora cluster (see
# `terraform/modules/data/aurora-postgres/main.tf`) so the cluster can
# PutObject directly without credentials in the SQL file.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "bucket_name" {
  description = "Name of the S3 backups bucket"
  type        = string
}

resource "aws_s3_bucket" "backups" {
  bucket = var.bucket_name

  tags = {
    Name  = var.bucket_name
    Stage = var.stage
    # Identifies the bucket's purpose so operators can spot accidental reads
    # in CloudTrail and so cost-allocation tags split backups out of the
    # primary storage bucket.
    Purpose = "operational-backups"
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-pre-drop-snapshots"
    status = "Enabled"

    filter {
      prefix = "pre-drop/"
    }

    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_policy" "backups_https_only" {
  bucket = aws_s3_bucket.backups.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceHTTPS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
    ]
  })
}

output "bucket_name" {
  description = "Name of the S3 backups bucket"
  value       = aws_s3_bucket.backups.id
}

output "bucket_arn" {
  description = "ARN of the S3 backups bucket"
  value       = aws_s3_bucket.backups.arn
}
