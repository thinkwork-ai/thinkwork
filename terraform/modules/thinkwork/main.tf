################################################################################
# Thinkwork Composite Root
#
# Wires the three tiers (foundation → data → app) together with sensible
# defaults. This is the module published to the Terraform Registry as
# `thinkwork-ai/thinkwork/aws`.
#
# For advanced composition, use the sub-modules directly:
#   source = "thinkwork-ai/thinkwork/aws//modules/foundation/vpc"
################################################################################

locals {
  bucket_name                    = var.bucket_name != "" ? var.bucket_name : "thinkwork-${var.stage}-storage"
  backups_bucket_name            = "thinkwork-${var.stage}-backups"
  compliance_anchor_bucket_name  = "thinkwork-${var.stage}-compliance-anchors"
  compliance_exports_bucket_name = "thinkwork-${var.stage}-compliance-exports"
  computer_task_subnet_ids = (
    length(module.vpc.public_subnet_ids) > 0
    ? module.vpc.public_subnet_ids
    : module.vpc.private_subnet_ids
  )

  # Hindsight is an optional add-on. Preferred toggle: var.enable_hindsight.
  # For one release we also honor the legacy var.memory_engine == "hindsight"
  # so existing tfvars keep working.
  hindsight_enabled      = var.enable_hindsight || var.memory_engine == "hindsight"
  cognee_enabled         = var.enable_cognee
  twenty_provisioned     = var.twenty_provisioned
  twenty_runtime_enabled = var.twenty_provisioned && var.twenty_runtime_enabled
  twenty_domain          = var.twenty_domain != "" ? var.twenty_domain : (var.www_domain != "" ? "crm.${var.www_domain}" : "")
  twenty_public_url      = var.twenty_public_url != "" ? var.twenty_public_url : (local.twenty_domain != "" ? "https://${local.twenty_domain}" : "")
  twenty_certificate_arn = var.twenty_certificate_arn != "" ? var.twenty_certificate_arn : var.www_certificate_arn
  twenty_email_domain    = var.twenty_email_domain != "" ? var.twenty_email_domain : var.ses_inbound_domain
  twenty_email_from_address = (
    var.twenty_email_from_address != ""
    ? var.twenty_email_from_address
    : local.twenty_email_domain != "" ? "noreply@${local.twenty_email_domain}" : ""
  )
  kestra_provisioned     = var.kestra_provisioned
  kestra_runtime_enabled = var.kestra_provisioned && var.kestra_runtime_enabled
  kestra_domain          = var.kestra_domain != "" ? var.kestra_domain : (var.www_domain != "" ? "orchestrate.${var.www_domain}" : "")
  kestra_public_url      = var.kestra_public_url != "" ? var.kestra_public_url : (local.kestra_domain != "" ? "https://${local.kestra_domain}" : "")
  kestra_certificate_arn = var.kestra_certificate_arn != "" ? var.kestra_certificate_arn : var.www_certificate_arn
  cognee_worker_subnet_ids = (
    length(module.vpc.private_subnet_ids) > 0
    ? module.vpc.private_subnet_ids
    : module.vpc.public_subnet_ids
  )

  # Canonical long-term memory engine for this deployment. Exactly one engine
  # is active per deployment for recall/inspect/export. Auto-selects from
  # enable_hindsight when var.memory_engine is left empty so existing deploys
  # keep working without config changes. Legacy value "managed" maps to
  # "agentcore".
  resolved_memory_engine = (
    var.memory_engine == "hindsight" || var.memory_engine == "agentcore"
    ? var.memory_engine
    : var.memory_engine == "managed"
    ? "agentcore"
    : local.hindsight_enabled ? "hindsight" : "agentcore"
  )

  # The end-user app is now canonically hosted at app.<domain>. Keep
  # computer_domain as a compatibility fallback so older module callers and
  # stages can upgrade without a flag-day.
  end_user_app_domain          = var.app_domain != "" ? var.app_domain : var.computer_domain
  end_user_app_certificate_arn = var.app_certificate_arn != "" ? var.app_certificate_arn : var.computer_certificate_arn
  computer_compat_redirect_enabled = (
    var.app_domain != "" &&
    var.computer_domain != "" &&
    var.computer_domain != local.end_user_app_domain
  )
  computer_compat_redirect_function_code = local.computer_compat_redirect_enabled ? trimspace(<<-EOF
    function handler(event) {
      var request = event.request;
      var host = request.headers.host && request.headers.host.value;
      if (host === "${var.computer_domain}") {
        var parts = [];
        var querystring = request.querystring || {};
        for (var key in querystring) {
          if (!querystring.hasOwnProperty(key)) continue;
          var item = querystring[key];
          if (item.multiValue) {
            for (var i = 0; i < item.multiValue.length; i++) {
              parts.push(key + '=' + item.multiValue[i].value);
            }
          } else if (item.value === '') {
            parts.push(key);
          } else {
            parts.push(key + '=' + item.value);
          }
        }
        return {
          statusCode: 301,
          statusDescription: 'Moved Permanently',
          headers: {
            location: {
              value: "https://${local.end_user_app_domain}" + request.uri + (parts.length ? '?' + parts.join('&') : '')
            }
          }
        };
      }
      return request;
    }
  EOF
  ) : ""
}

################################################################################
# Workspace Guard
################################################################################

module "workspace_guard" {
  source = "../_internal/workspace-guard"
  stage  = var.stage
}

resource "terraform_data" "cognee_configuration_guardrails" {
  count = var.enable_cognee ? 1 : 0

  input = {
    cognee_backend_mode            = var.cognee_backend_mode
    cognee_desired_count           = var.cognee_desired_count
    cognee_image_uri               = var.cognee_image_uri
    cognee_db_name                 = var.cognee_db_name
    cognee_db_password_secret_arn  = var.cognee_db_password_secret_arn
    cognee_llm_provider            = var.cognee_llm_provider
    cognee_embedding_provider      = var.cognee_embedding_provider
    cognee_bedrock_model_resources = var.cognee_bedrock_model_resource_arns
    public_subnet_count            = length(module.vpc.public_subnet_ids)
  }

  lifecycle {
    precondition {
      condition     = var.cognee_image_uri != ""
      error_message = "enable_cognee requires cognee_image_uri pinned to an immutable digest."
    }

    precondition {
      condition     = var.cognee_db_password_secret_arn != ""
      error_message = "enable_cognee requires cognee_db_password_secret_arn for a dedicated Cognee database user."
    }

    precondition {
      condition     = var.cognee_db_password_secret_arn != module.database.graphql_db_secret_arn
      error_message = "enable_cognee requires a dedicated Cognee database secret, not the shared Thinkwork admin database secret."
    }

    precondition {
      condition     = var.cognee_db_name != var.database_name
      error_message = "cognee_db_name must be distinct from the shared Thinkwork database name."
    }

    precondition {
      condition     = length(module.vpc.public_subnet_ids) > 0
      error_message = "enable_cognee requires at least one public subnet for the phase-1 public-subnet task egress pattern."
    }

    precondition {
      condition     = var.cognee_backend_mode != "dogfood" || var.cognee_desired_count == 1
      error_message = "cognee_backend_mode = dogfood requires cognee_desired_count = 1."
    }

    precondition {
      condition     = var.cognee_backend_mode != "remote" || (var.cognee_vector_db_url != "" && var.cognee_graph_database_url != "")
      error_message = "cognee_backend_mode = remote requires cognee_vector_db_url and cognee_graph_database_url."
    }

    precondition {
      condition = (
        (var.cognee_llm_provider == "bedrock" || var.cognee_llm_api_key_secret_arn != "") &&
        (var.cognee_embedding_provider == "bedrock" || var.cognee_embedding_api_key_secret_arn != "")
      )
      error_message = "Non-Bedrock Cognee LLM or embedding providers require matching secret ARN inputs."
    }

    precondition {
      condition = (
        (var.cognee_llm_provider != "bedrock" && var.cognee_embedding_provider != "bedrock") ||
        length(var.cognee_bedrock_model_resource_arns) > 0
      )
      error_message = "Bedrock Cognee providers require explicit cognee_bedrock_model_resource_arns."
    }
  }
}

resource "terraform_data" "twenty_configuration_guardrails" {
  count = local.twenty_provisioned ? 1 : 0

  input = {
    twenty_runtime_enabled           = local.twenty_runtime_enabled
    twenty_image_uri                 = var.twenty_image_uri
    twenty_db_name                   = var.twenty_db_name
    twenty_db_username               = var.twenty_db_username
    twenty_db_url_secret_arn         = var.twenty_db_url_secret_arn
    twenty_encryption_key_secret_arn = var.twenty_encryption_key_secret_arn
    twenty_public_url                = local.twenty_public_url
    twenty_certificate_arn           = local.twenty_certificate_arn
    public_subnet_count              = length(module.vpc.public_subnet_ids)
    cache_subnet_count               = length(module.vpc.private_subnet_ids)
  }

  lifecycle {
    precondition {
      condition     = var.twenty_image_uri != ""
      error_message = "twenty_provisioned requires twenty_image_uri pinned to an immutable digest."
    }

    precondition {
      condition     = var.twenty_db_url_secret_arn != ""
      error_message = "twenty_provisioned requires twenty_db_url_secret_arn for a dedicated Twenty database URL."
    }

    precondition {
      condition     = var.twenty_encryption_key_secret_arn != ""
      error_message = "twenty_provisioned requires twenty_encryption_key_secret_arn for Twenty ENCRYPTION_KEY."
    }

    precondition {
      condition     = var.twenty_db_url_secret_arn != module.database.graphql_db_secret_arn
      error_message = "twenty_provisioned requires a dedicated Twenty database URL secret, not the shared Thinkwork admin database secret."
    }

    precondition {
      condition     = var.twenty_db_name != var.database_name
      error_message = "twenty_db_name must be distinct from the shared Thinkwork database name."
    }

    precondition {
      condition     = local.twenty_public_url != ""
      error_message = "twenty_provisioned requires twenty_public_url or a www_domain-derived crm.<domain> URL."
    }

    precondition {
      condition     = local.twenty_certificate_arn != ""
      error_message = "twenty_provisioned requires twenty_certificate_arn or www_certificate_arn."
    }

    precondition {
      condition     = length(module.vpc.public_subnet_ids) > 0
      error_message = "twenty_provisioned requires at least one public subnet for the public ALB and phase-1 task egress pattern."
    }

    precondition {
      condition     = length(module.vpc.private_subnet_ids) > 0
      error_message = "twenty_provisioned requires at least one private subnet for ElastiCache."
    }

    precondition {
      condition     = !var.twenty_runtime_enabled || var.twenty_provisioned
      error_message = "twenty_runtime_enabled requires twenty_provisioned = true."
    }
  }
}

resource "terraform_data" "twenty_runtime_state_guardrails" {
  count = var.twenty_runtime_enabled && !var.twenty_provisioned ? 1 : 0

  input = {
    twenty_provisioned     = var.twenty_provisioned
    twenty_runtime_enabled = var.twenty_runtime_enabled
  }

  lifecycle {
    precondition {
      condition     = !var.twenty_runtime_enabled || var.twenty_provisioned
      error_message = "twenty_runtime_enabled requires twenty_provisioned = true."
    }
  }
}

resource "terraform_data" "kestra_configuration_guardrails" {
  count = local.kestra_provisioned ? 1 : 0

  input = {
    kestra_runtime_enabled       = local.kestra_runtime_enabled
    kestra_image_uri             = var.kestra_image_uri
    kestra_db_name               = var.kestra_db_name
    kestra_db_username           = var.kestra_db_username
    kestra_db_password_secret    = var.kestra_db_password_secret_arn
    kestra_basic_auth_secret_arn = var.kestra_basic_auth_secret_arn
    kestra_public_url            = local.kestra_public_url
    kestra_certificate_arn       = local.kestra_certificate_arn
    public_subnet_count          = length(module.vpc.public_subnet_ids)
  }

  lifecycle {
    precondition {
      condition     = var.kestra_image_uri != ""
      error_message = "kestra_provisioned requires kestra_image_uri pinned to an immutable digest."
    }

    precondition {
      condition     = var.kestra_db_password_secret_arn != ""
      error_message = "kestra_provisioned requires kestra_db_password_secret_arn for a dedicated Kestra database user."
    }

    precondition {
      condition     = var.kestra_basic_auth_secret_arn != ""
      error_message = "kestra_provisioned requires kestra_basic_auth_secret_arn for the Kestra UI/API service credential."
    }

    precondition {
      condition     = var.kestra_db_password_secret_arn != module.database.graphql_db_secret_arn
      error_message = "kestra_provisioned requires a dedicated Kestra database password secret, not the shared Thinkwork admin database secret."
    }

    precondition {
      condition     = var.kestra_db_name != var.database_name
      error_message = "kestra_db_name must be distinct from the shared Thinkwork database name."
    }

    precondition {
      condition     = local.kestra_public_url != ""
      error_message = "kestra_provisioned requires kestra_public_url or a www_domain-derived orchestrate.<domain> URL."
    }

    precondition {
      condition     = local.kestra_certificate_arn != ""
      error_message = "kestra_provisioned requires kestra_certificate_arn or www_certificate_arn."
    }

    precondition {
      condition     = length(module.vpc.public_subnet_ids) > 0
      error_message = "kestra_provisioned requires at least one public subnet for the public ALB and phase-1 task egress pattern."
    }

    precondition {
      condition     = !var.kestra_runtime_enabled || var.kestra_provisioned
      error_message = "kestra_runtime_enabled requires kestra_provisioned = true."
    }
  }
}

resource "terraform_data" "kestra_runtime_state_guardrails" {
  count = var.kestra_runtime_enabled && !var.kestra_provisioned ? 1 : 0

  input = {
    kestra_provisioned     = var.kestra_provisioned
    kestra_runtime_enabled = var.kestra_runtime_enabled
  }

  lifecycle {
    precondition {
      condition     = !var.kestra_runtime_enabled || var.kestra_provisioned
      error_message = "kestra_runtime_enabled requires kestra_provisioned = true."
    }
  }
}

resource "aws_security_group" "cognee_worker" {
  count = local.cognee_enabled ? 1 : 0

  name_prefix = "thinkwork-${var.stage}-cognee-worker-"
  description = "Knowledge Graph ingest Lambda access to Cognee and Aurora"
  vpc_id      = module.vpc.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "thinkwork-${var.stage}-cognee-worker-sg" }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group_rule" "aurora_from_cognee_worker" {
  count = local.cognee_enabled ? 1 : 0

  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.cognee_worker[0].id
  security_group_id        = module.database.db_security_group_id
}

################################################################################
# Foundation Tier
################################################################################

module "vpc" {
  source = "../foundation/vpc"

  stage                       = var.stage
  create_vpc                  = var.create_vpc
  existing_vpc_id             = var.existing_vpc_id
  existing_public_subnet_ids  = var.existing_public_subnet_ids
  existing_private_subnet_ids = var.existing_private_subnet_ids
}

module "kms" {
  source = "../foundation/kms"
  stage  = var.stage
}

module "cognito" {
  source = "../foundation/cognito"

  stage  = var.stage
  region = var.region

  create_cognito            = var.create_cognito
  existing_user_pool_id     = var.existing_user_pool_id
  existing_user_pool_arn    = var.existing_user_pool_arn
  existing_admin_client_id  = var.existing_admin_client_id
  existing_mobile_client_id = var.existing_mobile_client_id
  existing_identity_pool_id = var.existing_identity_pool_id

  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  oidc_identity_providers    = var.oidc_identity_providers
  saml_identity_providers    = var.saml_identity_providers
  pre_signup_lambda_zip      = var.pre_signup_lambda_zip
  email_source_arn           = var.cognito_email_source_arn
  from_email_address         = var.cognito_from_email_address
  reply_to_email_address     = var.cognito_reply_to_email_address
  invite_email_subject       = var.cognito_invite_email_subject
  invite_email_message = (
    var.cognito_invite_email_message != ""
    ? var.cognito_invite_email_message
    : format(
      "<p>You have been invited to ThinkWork.</p><p>Sign in: <a href=\"%s/sign-in\">%s/sign-in</a></p><p>Username: <strong>{username}</strong></p><p>Temporary password: <strong>{####}</strong></p>",
      local.end_user_app_domain != "" ? "https://${local.end_user_app_domain}" : "https://${module.computer_site.distribution_domain}",
      local.end_user_app_domain != "" ? "https://${local.end_user_app_domain}" : "https://${module.computer_site.distribution_domain}",
    )
  )

  # Single ThinkworkAdmin Cognito client serves the unified web app. The
  # historical client name stays for compatibility; the standalone admin
  # SPA/static site is retired. Each origin needs both bare and /auth/callback
  # entries because OAuth lands on /auth/callback and the SPA's post-OAuth
  # redirect lands on the bare origin.
  admin_callback_urls = distinct(concat(
    var.admin_callback_urls,
    ["https://${module.computer_site.distribution_domain}", "https://${module.computer_site.distribution_domain}/auth/callback"],
    local.end_user_app_domain != "" ? ["https://${local.end_user_app_domain}", "https://${local.end_user_app_domain}/auth/callback"] : [],
    var.computer_domain != "" ? ["https://${var.computer_domain}", "https://${var.computer_domain}/auth/callback"] : [],
    ["http://localhost:5180", "http://localhost:5180/auth/callback"],
    var.desktop_callback_urls
  ))
  admin_logout_urls = distinct(concat(
    var.admin_logout_urls,
    ["https://${module.computer_site.distribution_domain}"],
    local.end_user_app_domain != "" ? ["https://${local.end_user_app_domain}"] : [],
    var.computer_domain != "" ? ["https://${var.computer_domain}"] : [],
    ["http://localhost:5180"],
    var.desktop_callback_urls
  ))
  desktop_callback_urls = var.desktop_callback_urls
  mobile_callback_urls  = var.mobile_callback_urls
  mobile_logout_urls    = var.mobile_logout_urls
}

module "dns" {
  source = "../foundation/dns"
  stage  = var.stage
}

################################################################################
# Data Tier
################################################################################

module "s3" {
  source = "../data/s3-buckets"

  stage       = var.stage
  account_id  = var.account_id
  bucket_name = local.bucket_name
}

module "s3_backups" {
  source = "../data/s3-backups-bucket"

  stage       = var.stage
  bucket_name = local.backups_bucket_name
}

# Phase 3 U7 — WORM-protected S3 bucket for SOC2 Type 1 tamper-evident audit
# anchoring. Inert in this PR: the IAM role exists but no Lambda assumes it
# until U8a (master plan Decision #9 — inert→live seam swap). The bucket
# itself is fully provisioned (Object Lock enabled at create time, KMS-
# encrypted, lifecycle to Glacier IR at 90 days, deny-DeleteObject bucket
# policy). See `terraform/modules/data/compliance-audit-bucket/README.md`.
module "compliance_anchors" {
  source = "../data/compliance-audit-bucket"

  stage          = var.stage
  account_id     = var.account_id
  region         = var.region
  bucket_name    = local.compliance_anchor_bucket_name
  kms_key_arn    = module.kms.key_arn
  mode           = var.compliance_anchor_object_lock_mode
  retention_days = var.compliance_anchor_retention_days

  # Phase 3 U8a — anchor Lambda's IAM role gets `secretsmanager:GetSecretValue`
  # on these two compliance secrets (anchor connects as compliance_reader for
  # SELECT, compliance_drainer for tenant_anchor_state UPDATE).
  compliance_reader_secret_arn  = module.database.compliance_reader_secret_arn
  compliance_drainer_secret_arn = module.database.compliance_drainer_secret_arn
}

# Phase 3 U11.U2 — Compliance exports bucket + runner IAM role.
#
# Ephemeral S3 bucket with 7-day lifecycle expiration. NOT Object Lock
# — exports are derivable from compliance.audit_events; the bucket is
# delivery plumbing, not the system of record. The runner Lambda assumes
# `module.compliance_exports.runner_role_arn` and writes CSV/NDJSON
# artifacts under any key (no per-prefix grant needed). U11.U2 ships the
# function with a stub body; U11.U3 swaps in the live runner.
module "compliance_exports" {
  source = "../data/compliance-exports-bucket"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = local.compliance_exports_bucket_name
  # Runner Lambda reads writer-pool DB credentials at module-load to
  # construct the Aurora connection string for INSERT/UPDATE on
  # compliance.export_jobs and SELECT on compliance.audit_events.
  # Without this grant the runner throws AccessDenied at first SQS
  # invocation (deploy run 25561658625 failed the smoke gate this way).
  database_secret_arn                  = module.database.graphql_db_secret_arn
  enable_runner_database_secret_access = true
}

module "database" {
  source = "../data/aurora-postgres"

  stage = var.stage

  create_database               = var.create_database
  existing_db_cluster_arn       = var.existing_db_cluster_arn
  existing_db_secret_arn        = var.existing_db_secret_arn
  existing_db_endpoint          = var.existing_db_endpoint
  existing_db_security_group_id = var.existing_db_security_group_id

  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.public_subnet_ids
  db_password = var.db_password

  database_name   = var.database_name
  database_engine = var.database_engine

  # Enables the `aws_s3` Aurora extension and attaches an IAM role that can
  # PutObject into the backups bucket's pre-drop/* prefix. Used by
  # destructive migrations (e.g. U5 of the thread-detail cleanup plan) to
  # snapshot row data before DROP TABLE. `enable_aws_s3` is the plan-time
  # gate (the bucket's ARN is known-after-apply on greenfield, so it can't
  # drive `count` directly); the ARN still feeds the IAM policy body.
  backups_bucket_arn = module.s3_backups.bucket_arn
  enable_aws_s3      = var.database_engine == "aurora-serverless"
}

module "bedrock_kb" {
  source = "../data/bedrock-knowledge-base"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name
}

################################################################################
# App Tier
################################################################################

# Subscription-only schema for AppSync — typed event payloads (from schema:build)
locals {
  subscription_schema = file("${path.module}/../../schema.graphql")
}

module "appsync" {
  source = "../app/appsync-subscriptions"

  stage               = var.stage
  region              = var.region
  user_pool_id        = module.cognito.user_pool_id
  subscription_schema = local.subscription_schema
}

locals {
  deployment_terraform_state_bucket  = var.deployment_terraform_state_bucket != "" ? var.deployment_terraform_state_bucket : "thinkwork-terraform-state"
  deployment_terraform_lock_table    = var.deployment_terraform_lock_table != "" ? var.deployment_terraform_lock_table : "thinkwork-terraform-locks"
  deployment_release_artifact_bucket = var.deployment_release_artifact_bucket != "" ? var.deployment_release_artifact_bucket : "thinkwork-release-artifacts"
}

module "deployment_control_plane" {
  count  = var.enable_deployment_control_plane ? 1 : 0
  source = "../app/deployment-control-plane"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region

  release_version         = var.deployment_release_version
  release_manifest_url    = var.deployment_release_manifest_url
  release_manifest_sha256 = var.deployment_release_manifest_sha256

  terraform_state_bucket  = local.deployment_terraform_state_bucket
  terraform_lock_table    = local.deployment_terraform_lock_table
  release_artifact_bucket = local.deployment_release_artifact_bucket

  terraform_module_source  = var.deployment_terraform_module_source
  terraform_module_version = var.deployment_terraform_module_version

  log_retention_days         = var.deployment_control_plane_log_retention_days
  create_secret_placeholders = var.deployment_control_plane_create_secret_placeholders
}

module "api" {
  source = "../app/lambda-api"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region

  lambda_artifact_bucket   = var.lambda_artifact_bucket
  lambda_artifact_prefix   = var.lambda_artifact_prefix
  require_lambda_artifacts = var.require_lambda_artifacts

  db_cluster_arn        = module.database.db_cluster_arn
  db_cluster_endpoint   = module.database.cluster_endpoint
  graphql_db_secret_arn = module.database.graphql_db_secret_arn
  database_name         = var.database_name

  # Phase 3 U4 — compliance-outbox-drainer connects as `compliance_drainer`
  # via this dedicated secret (provisioned in U2 / PR #887, populated by
  # the compliance-bootstrap CI step in deploy.yml).
  compliance_drainer_secret_arn = module.database.compliance_drainer_secret_arn

  # Phase 3 U7 — anchor bucket + IAM role wiring. U8a now uses these to
  # provision the standalone anchor Lambda function + watchdog + schedules.
  compliance_anchor_bucket_arn       = module.compliance_anchors.bucket_arn
  compliance_anchor_bucket_name      = module.compliance_anchors.bucket_name
  compliance_anchor_lambda_role_arn  = module.compliance_anchors.lambda_role_arn
  compliance_anchor_lambda_role_name = module.compliance_anchors.lambda_role_name

  # Phase 3 U8b — sibling watchdog role (kms:DescribeKey only on the CMK,
  # s3:ListBucket prefix-conditioned). The watchdog moves OFF the shared
  # lambda role onto this dedicated role; the move is a `terraform state
  # mv` operator step documented in the U8b plan.
  compliance_anchor_watchdog_role_arn  = module.compliance_anchors.watchdog_role_arn
  compliance_anchor_watchdog_role_name = module.compliance_anchors.watchdog_role_name

  # Phase 3 U8a — anchor Lambda runtime config. compliance_reader for
  # least-privilege SELECT on audit_events; retention_days forwarded as
  # the COMPLIANCE_ANCHOR_RETENTION_DAYS env var (consumed by U8b's
  # live function; pre-plumbed in U8a per Decision #11).
  compliance_reader_secret_arn                 = module.database.compliance_reader_secret_arn
  compliance_anchor_object_lock_retention_days = var.compliance_anchor_retention_days

  # Phase 3 U8b — KMS key + Object Lock mode forwarded as
  # COMPLIANCE_ANCHOR_KMS_KEY_ARN and COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE
  # env vars on the anchor Lambda. The live `_anchor_fn_live` requires
  # both: KMS for SSE-KMS PutObject, mode for the per-object retention
  # override applied to anchors/.
  compliance_anchor_kms_key_arn      = module.compliance_anchors.kms_key_arn
  compliance_anchor_object_lock_mode = module.compliance_anchors.object_lock_mode

  # Phase 3 U11.U2 — exports bucket + runner role wiring. The U11.U1
  # createComplianceExport mutation dispatches jobIds to the SQS queue
  # provisioned inside lambda-api; the runner Lambda assumes the role
  # below and writes CSV/NDJSON artifacts to the bucket.
  compliance_exports_bucket_name      = module.compliance_exports.bucket_name
  compliance_exports_runner_role_arn  = module.compliance_exports.runner_role_arn
  compliance_exports_runner_role_name = module.compliance_exports.runner_role_name

  bucket_name = module.s3.bucket_name
  bucket_arn  = module.s3.bucket_arn

  user_pool_id        = module.cognito.user_pool_id
  user_pool_arn       = module.cognito.user_pool_arn
  admin_client_id     = module.cognito.admin_client_id
  mobile_client_id    = module.cognito.mobile_client_id
  cognito_auth_domain = module.cognito.auth_domain

  appsync_api_url = module.appsync.graphql_api_url
  appsync_api_key = module.appsync.graphql_api_key

  kb_service_role_arn = module.bedrock_kb.kb_service_role_arn

  lambda_zips_dir                               = var.lambda_zips_dir
  api_auth_secret                               = var.api_auth_secret
  db_password                                   = var.db_password
  bootstrap_credential_lease_kms_key_id         = var.bootstrap_credential_lease_kms_key_id
  agentcore_pi_function_name                    = module.agentcore_pi.agentcore_pi_function_name
  agentcore_pi_function_arn                     = module.agentcore_pi.agentcore_pi_function_arn
  enable_agentcore_pi_invoke_policy             = true
  hindsight_endpoint                            = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id                           = module.agentcore_memory.memory_id
  memory_engine                                 = local.resolved_memory_engine
  cognee_enabled                                = local.cognee_enabled
  cognee_endpoint                               = local.cognee_enabled ? module.cognee[0].cognee_endpoint : ""
  cognee_log_group_name                         = local.cognee_enabled ? module.cognee[0].cognee_log_group_name : ""
  cognee_backend_mode                           = local.cognee_enabled ? module.cognee[0].cognee_backend_mode : ""
  cognee_cluster_arn                            = local.cognee_enabled ? module.cognee[0].cognee_cluster_arn : ""
  cognee_service_name                           = local.cognee_enabled ? module.cognee[0].cognee_service_name : ""
  cognee_worker_subnet_ids                      = local.cognee_enabled ? local.cognee_worker_subnet_ids : []
  cognee_worker_security_group_ids              = local.cognee_enabled ? [aws_security_group.cognee_worker[0].id] : []
  twenty_provisioned                            = local.twenty_provisioned
  twenty_runtime_enabled                        = local.twenty_runtime_enabled
  twenty_url                                    = local.twenty_provisioned ? module.twenty[0].twenty_url : ""
  twenty_alb_arn                                = local.twenty_provisioned ? module.twenty[0].twenty_alb_arn : ""
  twenty_target_group_arn                       = local.twenty_provisioned ? module.twenty[0].twenty_target_group_arn : ""
  twenty_cluster_arn                            = local.twenty_provisioned ? module.twenty[0].twenty_cluster_arn : ""
  twenty_server_service_name                    = local.twenty_provisioned ? module.twenty[0].twenty_server_service_name : ""
  twenty_worker_service_name                    = local.twenty_provisioned ? module.twenty[0].twenty_worker_service_name : ""
  twenty_server_log_group_name                  = local.twenty_provisioned ? module.twenty[0].twenty_server_log_group_name : ""
  twenty_worker_log_group_name                  = local.twenty_provisioned ? module.twenty[0].twenty_worker_log_group_name : ""
  kestra_provisioned                            = local.kestra_provisioned
  kestra_runtime_enabled                        = local.kestra_runtime_enabled
  kestra_url                                    = local.kestra_provisioned ? module.kestra[0].kestra_url : ""
  kestra_alb_arn                                = local.kestra_provisioned ? module.kestra[0].kestra_alb_arn : ""
  kestra_target_group_arn                       = local.kestra_provisioned ? module.kestra[0].kestra_target_group_arn : ""
  kestra_cluster_arn                            = local.kestra_provisioned ? module.kestra[0].kestra_cluster_arn : ""
  kestra_service_name                           = local.kestra_provisioned ? module.kestra[0].kestra_service_name : ""
  kestra_log_group_name                         = local.kestra_provisioned ? module.kestra[0].kestra_log_group_name : ""
  kestra_storage_bucket_name                    = local.kestra_provisioned ? module.kestra[0].kestra_storage_bucket_name : ""
  kestra_database_name                          = local.kestra_provisioned ? module.kestra[0].kestra_database_name : ""
  kestra_basic_auth_secret_arn                  = local.kestra_provisioned ? module.kestra[0].kestra_basic_auth_secret_arn : ""
  admin_url                                     = local.end_user_app_url
  docs_url                                      = "https://${module.docs_site.distribution_domain}"
  www_url                                       = var.www_domain != "" ? "https://${var.www_domain}" : "https://${module.www_site.distribution_domain}"
  stripe_price_ids_json                         = var.stripe_price_ids_json
  appsync_realtime_url                          = module.appsync.graphql_realtime_url
  ecr_repository_url                            = module.agentcore_platform.ecr_repository_url
  job_scheduler_role_arn                        = module.job_triggers.job_scheduler_role_arn
  routines_execution_role_arn                   = module.routines_stepfunctions.execution_role_arn
  routines_log_group_arn                        = module.routines_stepfunctions.log_group_arn
  deployment_state_machine_arn                  = var.enable_deployment_control_plane ? module.deployment_control_plane[0].state_machine_arn : ""
  deployment_evidence_bucket                    = var.enable_deployment_control_plane ? module.deployment_control_plane[0].evidence_bucket_name : ""
  enable_stripe_billing                         = var.enable_stripe_billing
  enable_slack_workspace_app                    = var.enable_slack_workspace_app
  agentcore_code_interpreter_id                 = var.agentcore_code_interpreter_id
  wiki_compile_model_id                         = var.wiki_compile_model_id
  company_brain_source_agent_model_id           = var.company_brain_source_agent_model_id
  wiki_aggregation_pass_enabled                 = var.wiki_aggregation_pass_enabled
  wiki_deterministic_linking_enabled            = var.wiki_deterministic_linking_enabled
  google_places_api_key                         = var.google_places_api_key
  enable_workspace_orchestration                = var.enable_workspace_orchestration
  requester_idle_memory_learning_enabled        = var.requester_idle_memory_learning_enabled
  requester_memory_dreaming_enabled             = var.requester_memory_dreaming_enabled
  requester_memory_dreaming_schedule_expression = var.requester_memory_dreaming_schedule_expression
  requester_memory_dreaming_model_id            = var.requester_memory_dreaming_model_id
  # Per-user OAuth client credentials — fed to Secrets Manager in
  # app/lambda-api/oauth-secrets.tf. Reuses the same google_oauth_client_*
  # tfvars that already flow to the Cognito federated-signin module.
  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  redirect_success_url       = var.redirect_success_url
  platform_operator_emails   = var.platform_operator_emails

  mcp_custom_domain       = var.mcp_custom_domain
  mcp_custom_domain_ready = var.mcp_custom_domain_ready

  depends_on = [module.cognito]
}

################################################################################
# AgentCore Memory (managed) — always created. Provides automatic per-turn
# retention via memory.store_turn_pair in the agent container. If the caller
# already has a memory resource, set `agentcore_memory_id` on the root module
# to short-circuit provisioning.
################################################################################

module "agentcore_memory" {
  source = "../app/agentcore-memory"

  stage              = var.stage
  region             = var.region
  account_id         = var.account_id
  existing_memory_id = var.agentcore_memory_id
}

module "agentcore_platform" {
  source = "../app/agentcore-platform"

  stage = var.stage
}

################################################################################
# AgentCore Pi — dedicated Lambda + log group + IAM role + event-invoke config.
# Shared AgentCore substrate lives in `module.agentcore_platform`.
################################################################################

module "agentcore_pi" {
  source = "../app/agentcore-pi"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name

  ecr_repository_url = module.agentcore_platform.ecr_repository_url
  source_image_uri   = var.agentcore_pi_source_image_uri
  async_dlq_arn      = module.agentcore_platform.agentcore_async_dlq_arn

  hindsight_endpoint                     = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id                    = module.agentcore_memory.memory_id
  memory_engine                          = local.resolved_memory_engine
  requester_idle_memory_learning_enabled = var.requester_idle_memory_learning_enabled

  api_endpoint    = module.api.api_endpoint
  api_auth_secret = var.api_auth_secret

  # Plan §005 U4 — AuroraSessionStore uses the RDS Data API. Cluster ARN
  # + secret come from the existing aurora-postgres module so Pi and
  # graphql-http hit the same cluster + same credential rotation surface.
  db_cluster_arn = module.database.db_cluster_arn
  db_secret_arn  = module.database.graphql_db_secret_arn
}

# Runtime identity rename: the former dedicated Flue module is now the Pi
# module. Move existing state to the renamed module/resource addresses so the
# deployed Lambda, role, log group, and invoke config are updated in place.
moved {
  from = module.agentcore_flue.aws_cloudwatch_log_group.agentcore_flue
  to   = module.agentcore_pi.aws_cloudwatch_log_group.agentcore_pi
}

moved {
  from = module.agentcore_flue.aws_lambda_function.agentcore_flue
  to   = module.agentcore_pi.aws_lambda_function.agentcore_pi
}

moved {
  from = module.agentcore_flue.aws_lambda_function_event_invoke_config.agentcore_flue
  to   = module.agentcore_pi.aws_lambda_function_event_invoke_config.agentcore_pi
}

moved {
  from = module.agentcore_flue.aws_iam_role.agentcore_flue
  to   = module.agentcore_pi.aws_iam_role.agentcore_pi
}

moved {
  from = module.agentcore_flue.aws_iam_role_policy.agentcore_flue
  to   = module.agentcore_pi.aws_iam_role_policy.agentcore_pi
}

moved {
  from = module.agentcore_flue.aws_iam_role_policy.agentcore_flue_dlq_send
  to   = module.agentcore_pi.aws_iam_role_policy.agentcore_pi_dlq_send
}

# Shared AgentCore platform resources moved out of the retired legacy runtime
# module so deleting that runtime does not destroy Pi's ECR repository or async
# invoke DLQ.
moved {
  from = module.agentcore.aws_ecr_repository.agentcore
  to   = module.agentcore_platform.aws_ecr_repository.agentcore
}

moved {
  from = module.agentcore.aws_ecr_lifecycle_policy.agentcore
  to   = module.agentcore_platform.aws_ecr_lifecycle_policy.agentcore
}

moved {
  from = module.agentcore.aws_sqs_queue.agentcore_async_dlq
  to   = module.agentcore_platform.aws_sqs_queue.agentcore_async_dlq
}

moved {
  from = module.routines_stepfunctions.aws_cloudwatch_event_rule.sfn_state_change[0]
  to   = module.api.aws_cloudwatch_event_rule.routine_sfn_state_change[0]
}

moved {
  from = module.routines_stepfunctions.aws_cloudwatch_event_target.sfn_state_change[0]
  to   = module.api.aws_cloudwatch_event_target.routine_sfn_state_change[0]
}

moved {
  from = module.routines_stepfunctions.aws_lambda_permission.sfn_state_change[0]
  to   = module.api.aws_lambda_permission.routine_sfn_state_change[0]
}

module "crons" {
  source = "../app/crons"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

module "job_triggers" {
  source = "../app/job-triggers"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

module "routines_stepfunctions" {
  source = "../app/routines-stepfunctions"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region

  # The Lambda API module owns EventBridge → routine-execution-callback
  # wiring because it owns the callback function resource. Keeping the
  # callback disabled here avoids a cycle: lambda-api needs the routines
  # execution role/log group outputs, while the callback permission needs
  # the lambda-api function to exist.
  execution_callback_lambda_arn = ""
}

module "hindsight" {
  count  = local.hindsight_enabled ? 1 : 0
  source = "../app/hindsight-memory"

  stage                = var.stage
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.public_subnet_ids
  db_security_group_id = module.database.db_security_group_id
  database_url         = module.database.database_url
  image_tag            = var.hindsight_image_tag

  enable_auto_consolidation     = var.hindsight_enable_auto_consolidation
  consolidation_dedup_threshold = var.hindsight_consolidation_dedup_threshold
  observations_mission          = var.hindsight_observations_mission
}

module "cognee" {
  count  = local.cognee_enabled ? 1 : 0
  source = "../app/cognee"

  stage                  = var.stage
  vpc_id                 = module.vpc.vpc_id
  subnet_ids             = module.vpc.public_subnet_ids
  db_security_group_id   = module.database.db_security_group_id
  db_host                = module.database.cluster_endpoint
  db_name                = var.cognee_db_name
  db_username            = var.cognee_db_username
  db_password_secret_arn = var.cognee_db_password_secret_arn

  allowed_internal_cidr_blocks = var.cognee_allowed_internal_cidr_blocks
  allowed_internal_security_group_ids = concat(
    var.cognee_allowed_internal_security_group_ids,
    [aws_security_group.cognee_worker[0].id],
  )
  image_uri     = var.cognee_image_uri
  desired_count = var.cognee_desired_count
  backend_mode  = var.cognee_backend_mode

  llm_provider           = var.cognee_llm_provider
  llm_model              = var.cognee_llm_model
  llm_api_key_secret_arn = var.cognee_llm_api_key_secret_arn

  embedding_provider           = var.cognee_embedding_provider
  embedding_model              = var.cognee_embedding_model
  embedding_dimensions         = var.cognee_embedding_dimensions
  embedding_api_key_secret_arn = var.cognee_embedding_api_key_secret_arn

  vector_db_provider       = var.cognee_vector_db_provider
  vector_db_url            = var.cognee_vector_db_url
  vector_db_key_secret_arn = var.cognee_vector_db_key_secret_arn

  graph_database_provider            = var.cognee_graph_database_provider
  graph_database_url                 = var.cognee_graph_database_url
  graph_database_username            = var.cognee_graph_database_username
  graph_database_password_secret_arn = var.cognee_graph_database_password_secret_arn

  bedrock_model_resource_arns = var.cognee_bedrock_model_resource_arns
  kms_key_arns                = var.cognee_kms_key_arns

  depends_on = [terraform_data.cognee_configuration_guardrails]
}

module "twenty" {
  count  = local.twenty_provisioned ? 1 : 0
  source = "../app/twenty"

  stage                = var.stage
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.public_subnet_ids
  cache_subnet_ids     = module.vpc.private_subnet_ids
  storage_subnet_ids   = module.vpc.private_subnet_ids
  db_security_group_id = module.database.db_security_group_id
  public_url           = local.twenty_public_url
  certificate_arn      = local.twenty_certificate_arn
  image_uri            = var.twenty_image_uri

  runtime_enabled      = local.twenty_runtime_enabled
  server_desired_count = var.twenty_server_desired_count
  worker_desired_count = var.twenty_worker_desired_count

  db_url_secret_arn                  = var.twenty_db_url_secret_arn
  encryption_key_secret_arn          = var.twenty_encryption_key_secret_arn
  fallback_encryption_key_secret_arn = var.twenty_fallback_encryption_key_secret_arn
  app_secret_arn                     = var.twenty_app_secret_arn

  email_from_address = local.twenty_email_from_address
  email_from_name    = var.twenty_email_from_name
  email_smtp_host    = var.twenty_email_smtp_host

  cache_engine                 = var.twenty_cache_engine
  cache_engine_version         = var.twenty_cache_engine_version
  cache_parameter_group_family = var.twenty_cache_parameter_group_family
  cache_node_type              = var.twenty_cache_node_type
  cache_num_cache_clusters     = var.twenty_cache_num_cache_clusters
  allowed_public_cidr_blocks   = var.twenty_allowed_public_cidr_blocks
  kms_key_arns                 = var.twenty_kms_key_arns

  depends_on = [terraform_data.twenty_configuration_guardrails]
}

module "kestra" {
  count  = local.kestra_provisioned ? 1 : 0
  source = "../app/kestra"

  stage                = var.stage
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.public_subnet_ids
  db_security_group_id = module.database.db_security_group_id
  db_host              = module.database.cluster_endpoint
  db_name              = var.kestra_db_name
  db_username          = var.kestra_db_username

  db_password_secret_arn = var.kestra_db_password_secret_arn
  basic_auth_secret_arn  = var.kestra_basic_auth_secret_arn
  public_url             = local.kestra_public_url
  certificate_arn        = local.kestra_certificate_arn
  image_uri              = var.kestra_image_uri

  runtime_enabled            = local.kestra_runtime_enabled
  desired_count              = var.kestra_desired_count
  storage_bucket_name        = var.kestra_storage_bucket_name
  storage_force_destroy      = var.kestra_storage_force_destroy
  allowed_public_cidr_blocks = var.kestra_allowed_public_cidr_blocks
  kms_key_arns               = var.kestra_kms_key_arns

  depends_on = [terraform_data.kestra_configuration_guardrails]
}

module "ses" {
  source = "../app/ses-email"

  stage         = var.stage
  account_id    = var.account_id
  region        = var.region
  email_domain  = var.ses_inbound_domain
  parent_domain = var.ses_parent_domain
  tenant_slugs  = var.ses_tenant_slugs

  inbound_bucket_name                = module.s3.bucket_name
  email_inbound_fn_arn               = module.api.email_inbound_fn_arn
  email_inbound_fn_name              = module.api.email_inbound_fn_name
  enable_email_inbound_lambda_action = true

  manage_active_rule_set = var.ses_manage_active_rule_set
}

################################################################################
# End-User App Static Site (apps/web — canonical surface at app.thinkwork.ai)
################################################################################

locals {
  # Host CSP for the Computer SPA (plan-012 U10 / contract v1 §CSP profile).
  # Generated apps always execute in the sandbox iframe shell, so the parent
  # origin never needs blob: script/worker execution for transformed modules.
  computer_host_script_src = "'self'"
  computer_host_worker_src = "'self'"
  computer_host_frame_src  = local.computer_sandbox_enabled ? "https://${var.computer_sandbox_domain}" : "'none'"
  computer_host_frame_ancestors = join(" ", compact([
    "'self'",
  ]))

  computer_host_csp = "default-src 'self'; script-src ${local.computer_host_script_src}; style-src 'self' 'unsafe-inline'; worker-src ${local.computer_host_worker_src}; frame-src ${local.computer_host_frame_src}; connect-src 'self' https://*.execute-api.${var.region}.amazonaws.com https://*.appsync-api.${var.region}.amazonaws.com wss://*.appsync-realtime-api.${var.region}.amazonaws.com https://cognito-idp.${var.region}.amazonaws.com https://*.auth.${var.region}.amazoncognito.com; img-src 'self' data: blob: ${local.computer_sandbox_map_img_src}; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors ${local.computer_host_frame_ancestors};"
}

module "computer_site" {
  source = "../app/static-site"

  stage         = var.stage
  site_name     = "computer"
  bucket_name   = "thinkwork-${var.stage}-${var.account_id}-computer"
  is_spa        = true
  custom_domain = local.end_user_app_domain
  custom_domain_aliases = local.computer_compat_redirect_enabled ? [
    var.computer_domain,
  ] : []
  certificate_arn              = local.end_user_app_certificate_arn
  viewer_request_function_code = local.computer_compat_redirect_function_code

  # Plan-012 U10: host CSP defends the parent origin. Iframe-shell's
  # own CSP (set on computer_sandbox_site below) carries the
  # `connect-src 'none'` + `frame-ancestors` allowlist defense as
  # belt-and-suspenders.
  inline_response_headers = {
    content_security_policy       = local.computer_host_csp
    content_type_options_override = true
    strict_transport_security = {
      max_age_sec        = 63072000
      include_subdomains = true
      preload            = true
      override           = true
    }
  }
}

################################################################################
# Computer Sandbox Static Site (sandbox.thinkwork.ai — LLM-fragment iframe host)
#
# Plan-012 U3. Cross-origin sandbox subdomain that hosts the iframe-shell
# bundle. The iframe document is loaded from this distribution by the
# Computer SPA (computer_site above) via `<iframe sandbox="allow-scripts"
# src="https://sandbox.thinkwork.ai/iframe-shell.html">`. Because the
# sandbox attribute omits `allow-same-origin`, the iframe runs at an opaque
# origin — the parent uses `targetOrigin: "*"` for postMessage delivery
# and trust comes from pinned src + iframe-side parent-origin allowlist +
# channelId nonce + no-secrets-in-payload (see contract v1).
#
# Bucket is empty in this PR. U9 populates it with the iframe-shell bundle
# via scripts/build-web.sh.
#
# Iframe CSP profile (per contract v1 §CSP profile):
#   default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:;
#   style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:
#     https://*.tile.openstreetmap.org https://api.mapbox.com;
#   font-src 'self' data:; connect-src 'none';
#   frame-src https://www.openstreetmap.org; object-src 'none';
#   base-uri 'self'; frame-ancestors <web parents + desktop custom protocols>;
#
# Provisioning is gated on var.computer_sandbox_domain — leave empty in
# stages that haven't allocated the subdomain yet.
################################################################################

locals {
  computer_sandbox_enabled = var.computer_sandbox_domain != ""

  computer_sandbox_desktop_parent_origins = [
    "thinkwork://app",
    "thinkwork-dev://app",
    "thinkwork-canary://app",
  ]
  computer_sandbox_allowed_parent_origin_list = distinct(concat(
    [
      for origin in split(",", replace(var.computer_sandbox_allowed_parent_origins, " ", "")) :
      origin if origin != ""
    ],
    local.computer_sandbox_desktop_parent_origins
  ))
  computer_sandbox_allowed_parent_origins_effective = join(",", local.computer_sandbox_allowed_parent_origin_list)
  computer_sandbox_frame_ancestors                  = local.computer_sandbox_enabled && length(local.computer_sandbox_allowed_parent_origin_list) > 0 ? join(" ", local.computer_sandbox_allowed_parent_origin_list) : "'none'"

  computer_sandbox_map_img_src   = "https://*.tile.openstreetmap.org https://api.mapbox.com"
  computer_sandbox_map_frame_src = "https://www.openstreetmap.org"

  computer_sandbox_csp = "default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${local.computer_sandbox_map_img_src}; font-src 'self' data:; connect-src 'none'; frame-src ${local.computer_sandbox_map_frame_src}; object-src 'none'; base-uri 'self'; frame-ancestors ${local.computer_sandbox_frame_ancestors};"
}

module "computer_sandbox_site" {
  source = "../app/static-site"
  count  = local.computer_sandbox_enabled ? 1 : 0

  stage           = var.stage
  site_name       = "computer-sandbox"
  bucket_name     = "thinkwork-${var.stage}-${var.account_id}-computer-sandbox"
  is_spa          = false
  custom_domain   = var.computer_sandbox_domain
  certificate_arn = var.computer_sandbox_certificate_arn

  # Iframe CSP — load-bearing for the cross-origin sandbox security
  # boundary. connect-src 'none' is the defense-in-depth invariant: even
  # if the host CSP regresses, the iframe cannot exfiltrate via fetch /
  # XHR / WebSocket because the browser blocks the request inside the
  # iframe scope.
  inline_response_headers = {
    content_security_policy       = local.computer_sandbox_csp
    content_type_options_override = true
    # The iframe document runs with an opaque "null" origin because the
    # parent sets sandbox="allow-scripts" without allow-same-origin.
    # Module-script and asset requests from that document are therefore
    # CORS requests back to this distribution. Allow public reads from
    # any origin; credentials are false and the sandbox CSP still keeps
    # connect-src 'none'.
    cors = {
      allow_origins     = ["*"]
      allow_methods     = ["GET", "HEAD", "OPTIONS"]
      allow_headers     = ["*"]
      allow_credentials = false
      max_age_sec       = 600
      origin_override   = true
    }
    strict_transport_security = {
      max_age_sec        = 63072000 # 2 years
      include_subdomains = true
      preload            = true
      override           = true
    }
  }
}

################################################################################
# Docs Static Site
################################################################################

module "docs_site" {
  source = "../app/static-site"

  stage           = var.stage
  site_name       = "docs"
  bucket_name     = "thinkwork-${var.stage}-${var.account_id}-docs"
  custom_domain   = var.docs_domain
  certificate_arn = var.docs_certificate_arn
}

################################################################################
# Public Website (www)
################################################################################

module "www_site" {
  source = "../app/static-site"

  stage           = var.stage
  site_name       = "www"
  bucket_name     = "thinkwork-${var.stage}-${var.account_id}-www"
  custom_domain   = var.www_domain
  certificate_arn = var.www_certificate_arn
  # is_spa defaults to false — SSG output, directory URIs get rewritten to index.html
}
