################################################################################
# Compliance Audit Bucket — Data Module
#
# WORM-protected S3 bucket for SOC2 Type 1 tamper-evident audit anchoring.
# Stores Merkle-anchor evidence (anchors/) and per-tenant proof slices
# (proofs/). The bucket itself is the substrate; the anchor Lambda (U8a/U8b)
# is the writer; the audit-verifier CLI (U9) is the reader.
#
# Object Lock posture:
#   - Enabled at create time (one-way commit; cannot be disabled later).
#   - Default retention = var.retention_days (365 days = SOC2 Type 1 baseline).
#   - Default mode = GOVERNANCE (var.mode); flip to COMPLIANCE in prod via
#     tfvars at audit-engagement time. COMPLIANCE is irreversible — even AWS
#     root cannot delete or shorten retention until it expires.
#
# Prefix contract:
#   - anchors/ — WORM-protected Merkle anchors (subject to default retention).
#   - proofs/  — per-tenant proof slices written by the anchor Lambda. The
#                bucket-level lock applies, but U8b sets a shorter per-object
#                retention because slices are derivable from the chain + anchor.
#
# Bucket policy (defense-in-depth):
#   - EnforceHTTPS: deny any s3:* over plain HTTP.
#   - DenyDeleteObject: deny s3:DeleteObject and s3:DeleteObjectVersion from
#     any principal — even bypassing Object Lock can't satisfy this policy.
#
# IAM role (anchor Lambda's eventual identity, defined below):
#   - Allow s3:PutObject + s3:PutObjectRetention + s3:GetObject +
#     s3:GetObjectRetention on ${bucket}/anchors/* and ${bucket}/proofs/*.
#   - Allow s3:GetBucketObjectLockConfiguration on ${bucket}.
#   - Allow kms:GenerateDataKey + kms:Decrypt + kms:DescribeKey on the CMK.
#   - **Explicit Deny** s3:BypassGovernanceRetention and s3:PutObjectLegalHold
#     on ${bucket}/* — the explicit deny survives any future broadening of
#     the role's IAM grants (matches master plan U7 line 517).
#
# Inert seam:
#   - U7 ships the role; no Lambda assumes it until U8a (master plan
#     Decision #9 — inert→live seam swap).
#
# `force_destroy = false` is hardcoded. Object Lock + force_destroy is
# pathologically incompatible: COMPLIANCE-mode buckets cannot be emptied
# until retention expires; GOVERNANCE-mode emptying requires
# s3:BypassGovernanceRetention which we explicitly deny on the Lambda role.
# Dev cleanup is documented in README.md (admin role + bypass flag).
################################################################################

resource "aws_s3_bucket" "anchor" {
  bucket              = var.bucket_name
  object_lock_enabled = true

  # Hardcoded false — see header comment.
  force_destroy = false

  tags = {
    Name      = var.bucket_name
    Stage     = var.stage
    Purpose   = "compliance-anchors"
    Retention = "${var.retention_days}d"
  }
}

resource "aws_s3_bucket_versioning" "anchor" {
  bucket = aws_s3_bucket.anchor.id

  # Object Lock requires versioning. Enabling Object Lock at bucket creation
  # auto-enables versioning at the AWS level, but the provider model still
  # expects this resource declared for state tracking and drift detection.
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "anchor" {
  bucket = aws_s3_bucket.anchor.id

  # AWS rejects PutBucketObjectLockConfiguration before versioning is
  # Enabled. The explicit dependency prevents Terraform from applying both
  # in parallel and getting a 400 from S3 (InvalidRequest: Versioning must
  # be Enabled). We use the standalone resource (not the deprecated inline
  # block on aws_s3_bucket) because the inline form is not drift-detected
  # by Terraform — see HashiCorp v4.0 S3 refactor blog.
  depends_on = [aws_s3_bucket_versioning.anchor]

  # Production stages must run COMPLIANCE mode. GOVERNANCE-mode in prod
  # would let any principal with s3:BypassGovernanceRetention shorten or
  # delete retention windows — the auditor question "can anyone bypass
  # this?" gets the wrong answer. README documents the cutover playbook
  # (one-line tfvars change at audit-engagement time). This precondition
  # closes the operator-memory gap by failing the plan instead of silently
  # shipping a misconfigured bucket.
  lifecycle {
    precondition {
      condition     = !(contains(["prod", "production"], var.stage) && var.mode == "GOVERNANCE")
      error_message = "var.mode must be COMPLIANCE for prod stages (var.stage = '${var.stage}'). See terraform/modules/data/compliance-audit-bucket/README.md COMPLIANCE-mode cutover playbook. Override at audit-engagement time via the composite-root tfvars compliance_anchor_object_lock_mode = \"COMPLIANCE\"."
    }
    # Phase 3 U8b — block COMPLIANCE on non-prod by default (Decision #18).
    # COMPLIANCE bytes are unrecoverable for the full retention window even by
    # AWS root, so a typo'd stage name producing a dev-bucket COMPLIANCE
    # cluster is a one-way disaster. The operator sets
    # `allow_compliance_in_non_prod = true` in tfvars on the specific
    # non-prod stage where COMPLIANCE is intentional (e.g., a staging
    # rehearsal stage during audit prep).
    precondition {
      condition     = !(!contains(["prod", "production"], var.stage) && var.mode == "COMPLIANCE") || var.allow_compliance_in_non_prod
      error_message = "var.mode = \"COMPLIANCE\" on non-prod stage '${var.stage}' is blocked by default. COMPLIANCE bytes are unrecoverable for the full ${var.retention_days}-day retention window. To intentionally enable on this stage, set `allow_compliance_in_non_prod = true` in tfvars. See terraform/modules/data/compliance-audit-bucket/README.md."
    }
  }

  rule {
    default_retention {
      mode = var.mode
      days = var.retention_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "anchor" {
  bucket = aws_s3_bucket.anchor.id

  # Resource-level precondition: belt-and-suspenders alongside the variable
  # validation. If module.kms.key_arn is ever empty (e.g., create_kms_key =
  # false somewhere upstream without an existing_kms_key_arn), fail at plan
  # time, not apply time.
  lifecycle {
    precondition {
      condition     = length(var.kms_key_arn) > 0
      error_message = "kms_key_arn must be non-empty — check that module.kms is enabled in the composite root."
    }
  }

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }

    # Bucket Key reduces KMS request volume by up to 99%. With Bucket Key
    # enabled, the KMS encryption context is the bucket ARN, not the
    # object ARN — relevant if a future per-object encryption-context
    # condition lands.
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "anchor" {
  bucket = aws_s3_bucket.anchor.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "anchor" {
  bucket = aws_s3_bucket.anchor.id

  # Object Lock requires versioning, which the lifecycle config interacts
  # with via noncurrent_version_*. Sequence after versioning to avoid the
  # provider's "must enable versioning before lifecycle on a versioned
  # bucket" warning on first apply.
  depends_on = [aws_s3_bucket_versioning.anchor]

  rule {
    id     = "anchor-glacier-ir"
    status = "Enabled"

    # Scope to anchors/ — long-lived WORM evidence is the only thing worth
    # transitioning. proofs/ is short-lived per-tenant slice data (U8b
    # owns retention semantics there) and small enough that Glacier IR's
    # 90-day billing minimum eats any savings.
    filter {
      prefix = "anchors/"
    }

    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }

    # Defense for hypothetical overwrite events (anchors are append-only by
    # design but versioning is on). 90-day floor matches the Glacier IR
    # billing minimum.
    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "GLACIER_IR"
    }

    # **No** expiration. Object Lock retention is the deletion gate. Post-
    # 365-day disposition (anchors become deletable but won't auto-delete)
    # is deferred to a follow-up after SOC2 auditor guidance — see plan
    # Scope Boundaries.
  }
}

resource "aws_s3_bucket_policy" "anchor" {
  bucket = aws_s3_bucket.anchor.id

  # aws_s3_bucket_public_access_block must apply first; otherwise account-
  # level BPA defaults can intermittently reject the bucket-policy PUT with
  # AccessDenied during initial apply.
  depends_on = [aws_s3_bucket_public_access_block.anchor]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceHTTPS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.anchor.arn,
          "${aws_s3_bucket.anchor.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        # Defense-in-depth against accidental or malicious object deletes.
        # The anchor Lambda role's allow grants do NOT include any Delete
        # action; this policy prevents any other principal (including a
        # principal that gains s3:BypassGovernanceRetention via a future
        # role broadening) from removing audit evidence. Master plan
        # U7 line 518.
        Sid       = "DenyDeleteObject"
        Effect    = "Deny"
        Principal = "*"
        Action = [
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
        ]
        Resource = "${aws_s3_bucket.anchor.arn}/*"
      },
      {
        # Defense-in-depth against bucket-level deletion. Object Lock
        # protects the *contents*; this protects the *container* for the
        # post-retention window when objects become deletable. We do NOT
        # deny PutBucketPolicy / DeleteBucketPolicy here because Terraform
        # itself calls PutBucketPolicy to manage this resource — denying
        # it would lock out future module updates. Policy-rewrite defense
        # belongs at the IAM-policy layer on the deploying principal, not
        # at the bucket-policy layer.
        Sid       = "DenyBucketDelete"
        Effect    = "Deny"
        Principal = "*"
        Action = [
          "s3:DeleteBucket",
        ]
        Resource = aws_s3_bucket.anchor.arn
      },
    ]
  })
}

################################################################################
# IAM role for the anchor Lambda (U8a/U8b assumes this role).
#
# **Inert in U7.** No Lambda function references this role yet; U8a wires
# the function. The role exists so U7 ships a complete, atomic infrastructure
# unit (master plan U7 file list).
################################################################################

resource "aws_iam_role" "anchor_lambda" {
  name = "thinkwork-${var.stage}-compliance-anchor-lambda-role"

  # Phase 3 U8a — `aws:SourceArn` pin via string-construction to avoid
  # the circular dependency between this trust policy and the anchor
  # Lambda function (defined in lambda-api/handlers.tf, which depends on
  # this role's ARN). The function name follows the predictable pattern
  # `thinkwork-${stage}-api-compliance-anchor` so the literal ARN is
  # known at plan time.
  #
  # `StringEquals` (NOT `StringEqualsIfExists`) so a missing/empty
  # SourceArn on the AssumeRole call DENIES rather than no-ops.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
          "aws:SourceArn"     = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-compliance-anchor"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "anchor_basic" {
  role       = aws_iam_role.anchor_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "anchor_s3_allow" {
  name = "anchor-s3"
  role = aws_iam_role.anchor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Object-side actions — path-scoped to the two prefixes we use.
        # The wildcard inside the prefix is intentional (per-cadence object
        # keys vary), but the prefix itself is fixed.
        Sid    = "AnchorObjectsAllow"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectRetention",
          "s3:GetObject",
          "s3:GetObjectRetention",
        ]
        Resource = [
          "${aws_s3_bucket.anchor.arn}/anchors/*",
          "${aws_s3_bucket.anchor.arn}/proofs/*",
        ]
      },
      {
        # Bucket-side action — read-only metadata about Object Lock config
        # (the Lambda verifies the bucket is locked before writing).
        Sid    = "AnchorBucketAllow"
        Effect = "Allow"
        Action = [
          "s3:GetBucketObjectLockConfiguration",
        ]
        Resource = aws_s3_bucket.anchor.arn
      },
      {
        # **Explicit Deny** — survives a future broadening of the role's
        # IAM grants. Without this, a permissions-boundary change, an
        # AWS-managed-policy attachment containing s3:*, or an SCP grant
        # could silently re-enable WORM bypass. Master plan U7 line 517.
        Sid    = "DenyWormBypass"
        Effect = "Deny"
        Action = [
          "s3:BypassGovernanceRetention",
          "s3:PutObjectLegalHold",
        ]
        Resource = "${aws_s3_bucket.anchor.arn}/*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "anchor_kms" {
  name = "anchor-kms"
  role = aws_iam_role.anchor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AnchorKmsAllow"
        Effect = "Allow"
        # SSE-KMS PutObject (envelope encryption) needs only GenerateDataKey.
        # DescribeKey is the SDK pre-flight check some clients perform.
        # `kms:Decrypt` was removed in U8b — the anchor Lambda only writes;
        # the verifier (U9, separate role) is the read path. Least-privilege.
        Action = [
          "kms:GenerateDataKey",
          "kms:DescribeKey",
        ]
        Resource = var.kms_key_arn
      },
    ]
  })
}

# Phase 3 U8a — Secrets Manager read for the two compliance Aurora roles
# the anchor Lambda connects as (compliance_reader for SELECT,
# compliance_drainer for UPDATE on tenant_anchor_state).
#
# Note: today the compliance secrets use `aws/secretsmanager` (default
# AWS-managed key) so no explicit KMS Decrypt grant is needed. If a
# future hardening pass migrates the secrets to a customer-managed CMK,
# add `kms:Decrypt` on that CMK to this role — the failure mode is a
# confusing AccessDeniedException from KMS, not Secrets Manager.
resource "aws_iam_role_policy" "anchor_secrets" {
  name = "anchor-secrets"
  role = aws_iam_role.anchor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AnchorSecretsAllow"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          var.compliance_reader_secret_arn,
          var.compliance_drainer_secret_arn,
        ]
      },
    ]
  })
}

# Phase 3 U8a — CloudWatch PutMetricData for the watchdog heartbeat
# (Decision #16) and U8b's live ComplianceAnchorGap. Namespace-scoped
# via condition so the role cannot publish into other namespaces.
#
# **Note on least-privilege:** the anchor Lambda itself never emits
# metrics in U8a (only the watchdog does, via the shared lambda role's
# compliance_watchdog_metrics policy). This grant on the U7 anchor role
# is pre-plumbed for U8b — at which point the anchor Lambda may emit
# its own metrics around the live S3 path. If U8b doesn't end up
# needing it, this policy can be removed in U8b's PR.
resource "aws_iam_role_policy" "anchor_cloudwatch_metrics" {
  name = "anchor-cloudwatch-metrics"
  role = aws_iam_role.anchor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AnchorMetricsAllow"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Thinkwork/Compliance"
          }
        }
      },
    ]
  })
}

################################################################################
# Phase 3 U8b — Sibling IAM role for the anchor watchdog Lambda.
#
# The watchdog moves OFF the shared `aws_iam_role.lambda` (which is bound
# to ~60 unrelated handlers) onto a dedicated role. Two reasons:
#   1. Least privilege — the watchdog needs s3:ListBucket + s3:GetObject
#      against the WORM bucket, plus kms:DescribeKey on the CMK. Adding
#      those grants to the shared lambda role widens the blast radius for
#      every other handler.
#   2. KMS posture — the watchdog gets `kms:DescribeKey` ONLY (NOT
#      `kms:Decrypt`). Watchdog never reads object bodies; it issues
#      ListObjectsV2 + LastModified metadata only. Decrypt-less is the
#      correct boundary (Decision #5 / SEC-U8B-003).
#
# Policy boundary mirrors the anchor role: s3:* path-scoped to anchors/
# (the watchdog only inspects the anchors/ prefix), explicit Deny on
# s3:BypassGovernanceRetention + s3:PutObjectLegalHold + every Delete
# action so a future broadening cannot turn the watchdog into a deletion
# vector.
################################################################################

resource "aws_iam_role" "anchor_watchdog_lambda" {
  name = "thinkwork-${var.stage}-compliance-anchor-watchdog"

  # `aws:SourceArn` pin via string-construction — the watchdog Lambda's
  # ARN follows the same predictable pattern as the anchor's, so we can
  # tighten the trust policy without a circular dependency.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
          "aws:SourceArn"     = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-compliance-anchor-watchdog"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "anchor_watchdog_basic" {
  role       = aws_iam_role.anchor_watchdog_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "anchor_watchdog_s3" {
  name = "anchor-watchdog-s3"
  role = aws_iam_role.anchor_watchdog_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Bucket-scoped ListBucket — prefix-conditioned so the watchdog
        # cannot enumerate proofs/ (which carries per-tenant metadata that
        # need not be visible to a metrics-only path).
        Sid      = "WatchdogListBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.anchor.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["anchors/", "anchors/*"]
          }
        }
      },
      {
        # GetObject grant on anchors/* is reserved for future HeadObject
        # hardening — U8b's path uses ListObjectsV2 metadata only and
        # never fetches body bytes. Granting now avoids re-running the
        # IAM role-policy update on a hot-path the day we add HeadObject.
        Sid      = "WatchdogGetAnchor"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.anchor.arn}/anchors/*"
      },
      {
        # Defense-in-depth: even though the role's allow grants do not
        # include any Delete or Bypass action, an explicit Deny survives
        # any future role broadening (e.g., AWS-managed-policy attachment).
        Sid    = "WatchdogDenyMutations"
        Effect = "Deny"
        Action = [
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:PutObject",
          "s3:PutObjectRetention",
          "s3:PutObjectLegalHold",
          "s3:BypassGovernanceRetention",
        ]
        Resource = "${aws_s3_bucket.anchor.arn}/*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "anchor_watchdog_kms" {
  name = "anchor-watchdog-kms"
  role = aws_iam_role.anchor_watchdog_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # `kms:DescribeKey` ONLY — the watchdog never reads object bodies
        # so it never needs `kms:Decrypt`. SEC-U8B-003.
        Sid      = "WatchdogKmsDescribe"
        Effect   = "Allow"
        Action   = ["kms:DescribeKey"]
        Resource = var.kms_key_arn
      },
    ]
  })
}

resource "aws_iam_role_policy" "anchor_watchdog_cloudwatch_metrics" {
  name = "anchor-watchdog-cloudwatch-metrics"
  role = aws_iam_role.anchor_watchdog_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WatchdogMetricsAllow"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Thinkwork/Compliance"
          }
        }
      },
    ]
  })
}
