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
  hindsight_enabled = var.enable_hindsight || var.memory_engine == "hindsight"

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
}

################################################################################
# Workspace Guard
################################################################################

module "workspace_guard" {
  source = "../_internal/workspace-guard"
  stage  = var.stage
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
  pre_signup_lambda_zip      = var.pre_signup_lambda_zip

  # Single ThinkworkAdmin Cognito client serves both admin and computer SPAs.
  # apps/computer reuses this client by design — same humans, same tenant
  # invitations, single sign-in across both surfaces. Each origin (admin
  # distribution, admin custom domain, computer distribution, computer custom
  # domain, plus localhost dev for both) needs both bare and /auth/callback
  # entries because the OAuth flow lands on /auth/callback and the SPA's
  # post-OAuth redirect lands on the bare origin.
  admin_callback_urls = concat(
    var.admin_callback_urls,
    ["https://${module.admin_site.distribution_domain}", "https://${module.admin_site.distribution_domain}/auth/callback"],
    var.admin_domain != "" ? ["https://${var.admin_domain}", "https://${var.admin_domain}/auth/callback"] : [],
    ["https://${module.computer_site.distribution_domain}", "https://${module.computer_site.distribution_domain}/auth/callback"],
    var.computer_domain != "" ? ["https://${var.computer_domain}", "https://${var.computer_domain}/auth/callback"] : [],
    ["http://localhost:5180", "http://localhost:5180/auth/callback"]
  )
  admin_logout_urls = concat(
    var.admin_logout_urls,
    ["https://${module.admin_site.distribution_domain}"],
    var.admin_domain != "" ? ["https://${var.admin_domain}"] : [],
    ["https://${module.computer_site.distribution_domain}"],
    var.computer_domain != "" ? ["https://${var.computer_domain}"] : [],
    ["http://localhost:5180"]
  )
  mobile_callback_urls = var.mobile_callback_urls
  mobile_logout_urls   = var.mobile_logout_urls
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
  database_secret_arn = module.database.graphql_db_secret_arn
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

module "computer_runtime" {
  source = "../app/computer-runtime"

  stage            = var.stage
  account_id       = var.account_id
  region           = var.region
  vpc_id           = module.vpc.vpc_id
  subnet_ids       = module.vpc.private_subnet_ids
  task_subnet_ids  = local.computer_task_subnet_ids
  assign_public_ip = length(module.vpc.public_subnet_ids) > 0
  appsync_api_arn  = module.appsync.graphql_api_arn
}

module "api" {
  source = "../app/lambda-api"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region

  lambda_artifact_bucket = var.lambda_artifact_bucket
  lambda_artifact_prefix = var.lambda_artifact_prefix

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

  lambda_zips_dir                     = var.lambda_zips_dir
  api_auth_secret                     = var.api_auth_secret
  db_password                         = var.db_password
  agentcore_function_name             = module.agentcore.agentcore_function_name
  agentcore_flue_function_name        = module.agentcore_flue.agentcore_flue_function_name
  agentcore_function_arn              = module.agentcore.agentcore_function_arn
  agentcore_flue_function_arn         = module.agentcore_flue.agentcore_flue_function_arn
  hindsight_endpoint                  = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id                 = module.agentcore_memory.memory_id
  memory_engine                       = local.resolved_memory_engine
  admin_url                           = var.admin_domain != "" ? "https://${var.admin_domain}" : "https://${module.admin_site.distribution_domain}"
  docs_url                            = "https://${module.docs_site.distribution_domain}"
  www_url                             = var.www_domain != "" ? "https://${var.www_domain}" : "https://${module.www_site.distribution_domain}"
  stripe_price_ids_json               = var.stripe_price_ids_json
  appsync_realtime_url                = module.appsync.graphql_realtime_url
  ecr_repository_url                  = module.agentcore.ecr_repository_url
  job_scheduler_role_arn              = module.job_triggers.job_scheduler_role_arn
  routines_execution_role_arn         = module.routines_stepfunctions.execution_role_arn
  routines_log_group_arn              = module.routines_stepfunctions.log_group_arn
  agentcore_code_interpreter_id       = var.agentcore_code_interpreter_id
  wiki_compile_model_id               = var.wiki_compile_model_id
  company_brain_source_agent_model_id = var.company_brain_source_agent_model_id
  wiki_aggregation_pass_enabled       = var.wiki_aggregation_pass_enabled
  wiki_deterministic_linking_enabled  = var.wiki_deterministic_linking_enabled
  google_places_api_key               = var.google_places_api_key
  enable_workspace_orchestration      = var.enable_workspace_orchestration
  computer_runtime_cluster_name       = module.computer_runtime.cluster_name
  computer_runtime_cluster_arn        = module.computer_runtime.cluster_arn
  computer_runtime_efs_file_system_id = module.computer_runtime.efs_file_system_id
  computer_runtime_subnet_ids         = module.computer_runtime.task_subnet_ids
  computer_runtime_assign_public_ip   = module.computer_runtime.assign_public_ip
  computer_runtime_task_sg_id         = module.computer_runtime.task_security_group_id
  computer_runtime_execution_role_arn = module.computer_runtime.execution_role_arn
  computer_runtime_task_role_arn      = module.computer_runtime.task_role_arn
  computer_runtime_log_group_name     = module.computer_runtime.log_group_name
  computer_runtime_repository_url     = module.computer_runtime.repository_url
  computer_runtime_default_cpu        = module.computer_runtime.default_cpu
  computer_runtime_default_memory     = module.computer_runtime.default_memory
  computer_runtime_manager_policy_arn = module.computer_runtime.manager_policy_arn

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

module "agentcore" {
  source = "../app/agentcore-runtime"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name

  hindsight_endpoint  = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id = module.agentcore_memory.memory_id
  memory_engine       = local.resolved_memory_engine

  # Threaded through so the container's run_skill_dispatch can POST
  # terminal state back to /api/skills/complete. The lambda-api module
  # is declared above at line 156 as `module "api"`, so the reference
  # is `module.api` — not `module.lambda_api` (which doesn't exist and
  # broke terraform apply on every merge since #389).
  api_endpoint     = module.api.api_endpoint
  api_auth_secret  = var.api_auth_secret
  nova_act_api_key = var.nova_act_api_key
}

################################################################################
# AgentCore Flue — Plan §005 U2 splits the Flue Lambda + log group + IAM role
# + event-invoke config out of the Strands `agentcore-runtime` module into a
# dedicated module so Flue can carry its own permissions surface independently.
# The shared ECR repo and async DLQ stay with `module.agentcore` and are
# injected here.
################################################################################

module "agentcore_flue" {
  source = "../app/agentcore-flue"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name

  ecr_repository_url = module.agentcore.ecr_repository_url
  async_dlq_arn      = module.agentcore.agentcore_async_dlq_arn

  hindsight_endpoint  = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id = module.agentcore_memory.memory_id
  memory_engine       = local.resolved_memory_engine

  api_endpoint    = module.api.api_endpoint
  api_auth_secret = var.api_auth_secret

  # Plan §005 U4 — AuroraSessionStore uses the RDS Data API. Cluster ARN
  # + secret come from the existing aurora-postgres module so Flue and
  # graphql-http hit the same cluster + same credential rotation surface.
  db_cluster_arn = module.database.db_cluster_arn
  db_secret_arn  = module.database.graphql_db_secret_arn
}

# Plan §005 U2 — cross-module state migration. The Flue resources moved from
# `module.agentcore` to `module.agentcore_flue`; the underlying AWS resource
# attributes (function_name, log group name, ARN) are unchanged from U1, so
# this is pure state-address realignment without destroy+create.
#
# Two `moved {}` blocks per resource form a CHAIN that covers both possible
# starting states:
#   * Stages that never applied U1 (operator-managed greenfield, or any
#     stage that skipped the U1 deploy) have state at
#     `module.agentcore.aws_*.agentcore_pi` — the first block migrates that
#     to `module.agentcore.aws_*.agentcore_flue` (U1's destination), then
#     the second block migrates THAT to the new module.
#   * Stages that applied U1 (e.g. dev) have state at
#     `module.agentcore.aws_*.agentcore_flue` — only the second block
#     fires.
#
# Terraform follows the chain transitively. The earlier shape (both
# blocks pointing directly at `module.agentcore_flue.…`) was rejected
# with "Ambiguous move statements" because each destination can only have
# one source — chaining through the intermediate disambiguates while still
# covering both starting states.
moved {
  from = module.agentcore.aws_cloudwatch_log_group.agentcore_pi
  to   = module.agentcore.aws_cloudwatch_log_group.agentcore_flue
}

moved {
  from = module.agentcore.aws_cloudwatch_log_group.agentcore_flue
  to   = module.agentcore_flue.aws_cloudwatch_log_group.agentcore_flue
}

moved {
  from = module.agentcore.aws_lambda_function.agentcore_pi
  to   = module.agentcore.aws_lambda_function.agentcore_flue
}

moved {
  from = module.agentcore.aws_lambda_function.agentcore_flue
  to   = module.agentcore_flue.aws_lambda_function.agentcore_flue
}

moved {
  from = module.agentcore.aws_lambda_function_event_invoke_config.agentcore_pi
  to   = module.agentcore.aws_lambda_function_event_invoke_config.agentcore_flue
}

moved {
  from = module.agentcore.aws_lambda_function_event_invoke_config.agentcore_flue
  to   = module.agentcore_flue.aws_lambda_function_event_invoke_config.agentcore_flue
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

  # Phase B U9: EventBridge → routine-execution-callback. Constructed
  # from the lambda-api naming convention rather than referencing the
  # module output directly to avoid a cycle (lambda-api consumes
  # routines_execution_role_arn from this module). The function exists
  # for_each-iterated under aws_lambda_function.handler[*] in lambda-api;
  # the ARN follows the deterministic naming pattern.
  execution_callback_lambda_arn = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-routine-execution-callback"
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
}

module "ses" {
  source = "../app/ses-email"

  stage        = var.stage
  account_id   = var.account_id
  region       = var.region
  email_domain = var.ses_inbound_domain

  inbound_bucket_name   = module.s3.bucket_name
  email_inbound_fn_arn  = module.api.email_inbound_fn_arn
  email_inbound_fn_name = module.api.email_inbound_fn_name

  manage_active_rule_set = var.ses_manage_active_rule_set
}

################################################################################
# Admin Static Site
################################################################################

module "admin_site" {
  source = "../app/static-site"

  stage           = var.stage
  site_name       = "admin"
  is_spa          = true
  custom_domain   = var.admin_domain
  certificate_arn = var.admin_certificate_arn
}

################################################################################
# Computer Static Site (apps/computer — end-user surface at computer.thinkwork.ai)
################################################################################

locals {
  # Host CSP for the Computer SPA (plan-012 U10 / contract v1 §CSP profile).
  # script-src 'self' (no blob:) — sucrase no longer runs in the parent
  # window; it lives inside the iframe scope after Phase 2 fully ships.
  # frame-src allows the sandbox subdomain only; frame-ancestors 'none'
  # keeps the parent itself unframable.
  computer_host_frame_src = local.computer_sandbox_enabled ? "https://${var.computer_sandbox_domain}" : "'none'"

  computer_host_csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; frame-src ${local.computer_host_frame_src}; connect-src 'self' https://*.appsync-api.us-east-1.amazonaws.com wss://*.appsync-realtime-api.us-east-1.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';"
}

module "computer_site" {
  source = "../app/static-site"

  stage           = var.stage
  site_name       = "computer"
  is_spa          = true
  custom_domain   = var.computer_domain
  certificate_arn = var.computer_certificate_arn

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
# via scripts/build-computer.sh.
#
# Iframe CSP profile (per contract v1 §CSP profile):
#   default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:;
#   style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
#   font-src 'self' data:; connect-src 'none'; object-src 'none';
#   base-uri 'self'; frame-ancestors <var.computer_sandbox_allowed_parent_origins>;
#
# Provisioning is gated on var.computer_sandbox_domain — leave empty in
# stages that haven't allocated the subdomain yet.
################################################################################

locals {
  computer_sandbox_enabled = var.computer_sandbox_domain != ""

  computer_sandbox_frame_ancestors = local.computer_sandbox_enabled && var.computer_sandbox_allowed_parent_origins != "" ? join(" ", split(",", replace(var.computer_sandbox_allowed_parent_origins, " ", ""))) : "'none'"

  computer_sandbox_csp = "default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors ${local.computer_sandbox_frame_ancestors};"
}

module "computer_sandbox_site" {
  source = "../app/static-site"
  count  = local.computer_sandbox_enabled ? 1 : 0

  stage           = var.stage
  site_name       = "computer-sandbox"
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
  custom_domain   = var.www_domain
  certificate_arn = var.www_certificate_arn
  # is_spa defaults to false — SSG output, directory URIs get rewritten to index.html
}
