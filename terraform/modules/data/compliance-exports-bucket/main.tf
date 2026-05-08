################################################################################
# Compliance Exports Bucket — Data Module (U11.U2)
#
# Ephemeral S3 bucket for SOC2 walkthrough export artifacts produced by the
# U11 export runner Lambda. Distinct from the WORM-protected
# compliance-audit-bucket: this is a 7-day-lifecycle short-lived artifact
# bucket; nothing here is the system of record. The system of record is
# `compliance.audit_events` in Aurora; the runner just rematerializes
# filtered slices into CSV/NDJSON for auditor download.
#
# Why not Object Lock:
#   - Exports are derivable from the Aurora rows + the runner code; losing
#     an export does not lose evidence.
#   - Object Lock + 7-day retention is incoherent (the lock makes the
#     object undeleteable for 7 days then it does become deletable, which
#     is just a reverse-engineered version of expiration with extra cost).
#   - Auditors want a presigned URL that works for ~15 minutes; the bucket
#     itself is plumbing, not a trust anchor.
#
# Why versioning suspended:
#   - Export artifacts are write-once-by-name (key includes jobId UUID); a
#     second write would imply a runner bug, not a legitimate update. We
#     prefer the second write to fail noisily on a precondition rather than
#     silently produce a v2 object.
#
# Bucket policy (defense-in-depth):
#   - EnforceHTTPS: deny any s3:* over plain HTTP.
#
# IAM role (runner Lambda's eventual identity, defined below):
#   - Allow s3:PutObject + s3:GetObject + s3:GetObjectAttributes +
#     s3:AbortMultipartUpload on ${bucket}/* (any prefix; runner picks).
#   - Allow s3:ListBucket on ${bucket} (multipart upload listing).
#   - Explicit Deny on every other S3 ARN (NotResource defense).
#
# Inert seam (U11.U2):
#   - Module ships the role; the standalone Lambda function in
#     terraform/modules/app/lambda-api/handlers.tf assumes this role.
#   - The Lambda body is a stub that throws "not implemented" —
#     U11.U3 swaps in the live runner.
################################################################################

resource "aws_s3_bucket" "exports" {
  bucket = var.bucket_name

  # Hardcoded false — even though objects expire after 7 days, an
  # accidental terraform destroy on a bucket holding in-flight export
  # artifacts would interrupt an auditor mid-download.
  force_destroy = false

  tags = {
    Name       = var.bucket_name
    Stage      = var.stage
    Purpose    = "compliance-exports"
    Expiration = "${var.expiration_days}d"
  }
}

resource "aws_s3_bucket_versioning" "exports" {
  bucket = aws_s3_bucket.exports.id

  # Suspended — write-once-by-jobId; we don't want v1/v2 of the same key.
  versioning_configuration {
    status = "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket = aws_s3_bucket.exports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    id     = "exports-expiration"
    status = "Enabled"

    # Apply to every object — exports always live in keyed prefixes the
    # runner picks, but the lifecycle is uniform across the bucket.
    filter {}

    expiration {
      days = var.expiration_days
    }

    # Belt-and-suspenders for any failed multipart uploads — abort after
    # 1 day so we don't accumulate orphaned upload IDs.
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "exports" {
  bucket = aws_s3_bucket.exports.id

  depends_on = [aws_s3_bucket_public_access_block.exports]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceHTTPS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.exports.arn,
          "${aws_s3_bucket.exports.arn}/*",
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

################################################################################
# IAM role for the runner Lambda (U11.U3 will assume this role; in U11.U2
# the standalone Lambda function references this role's ARN, but its body
# is the inert stub).
################################################################################

resource "aws_iam_role" "runner_lambda" {
  name = "thinkwork-${var.stage}-compliance-export-runner-role"

  # `aws:SourceArn` pin via string-construction. Avoids the circular
  # dependency between this trust policy and the runner Lambda function
  # (defined in lambda-api/handlers.tf, which depends on this role's
  # ARN). The function name follows the predictable pattern
  # `thinkwork-${stage}-api-compliance-export-runner`.
  #
  # `StringEqualsIfExists` (NOT `StringEquals`) on `aws:SourceArn`
  # because `aws_lambda_event_source_mapping` triggers an internal
  # `sts:AssumeRole` validation at CreateEventSourceMapping time WITHOUT
  # a SourceArn context — `StringEquals` rejects that call and the
  # event-source mapping creation fails with "Please add Lambda as a
  # Trusted Entity for ...". `aws:SourceAccount` stays as a strict
  # equals — that key IS present in every AssumeRole call from Lambda,
  # and pinning the account is the substantive confused-deputy guard.
  # The anchor Lambda role can use strict StringEquals on SourceArn
  # because EventBridge Scheduler always passes SourceArn; SQS event
  # source mapping does not.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
        StringEqualsIfExists = {
          "aws:SourceArn" = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-compliance-export-runner"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "runner_basic" {
  role       = aws_iam_role.runner_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "runner_s3_allow" {
  name = "exports-s3-allow"
  role = aws_iam_role.runner_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ExportsObjectsAllow"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetObjectAttributes",
          "s3:AbortMultipartUpload",
        ]
        Resource = "${aws_s3_bucket.exports.arn}/*"
      },
      {
        Sid    = "ExportsBucketAllow"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:GetBucketLocation",
        ]
        Resource = aws_s3_bucket.exports.arn
      },
    ]
  })
}

resource "aws_iam_role_policy" "runner_secrets" {
  count = length(var.database_secret_arn) > 0 ? 1 : 0
  name  = "exports-runner-secrets"
  role  = aws_iam_role.runner_lambda.id

  # The runner reads the writer-pool DB credentials at module-load via
  # GetSecretValue. Without this grant the runner throws AccessDenied
  # at the first SQS-triggered invocation (deploy run 25561658625
  # failed the smoke gate with this exact error). Scoped to the single
  # secret ARN — no wildcard.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunnerDatabaseSecretRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.database_secret_arn
      },
    ]
  })
}

resource "aws_iam_role_policy" "runner_s3_deny_other_buckets" {
  name = "exports-s3-deny-other-buckets"
  role = aws_iam_role.runner_lambda.id

  # Defense-in-depth: even if a future inline-policy attachment or AWS-
  # managed-policy widens the role's S3 grants, this explicit deny
  # restricts the runner to the exports bucket only. NotResource ensures
  # the deny applies to every S3 ARN that ISN'T the exports bucket.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyAllOtherS3Buckets"
        Effect = "Deny"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:AbortMultipartUpload",
        ]
        NotResource = [
          aws_s3_bucket.exports.arn,
          "${aws_s3_bucket.exports.arn}/*",
        ]
      },
    ]
  })
}
